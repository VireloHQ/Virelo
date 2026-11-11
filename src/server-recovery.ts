import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { isLoopbackAddress } from './request-security.js';
import { isLocale } from './languages.js';
import type { IncomingHttpHeaders } from 'node:http';

export function sameOriginRecoveryNavigation(headers: IncomingHttpHeaders) {
  // no-referrer can make a browser send Origin: null for a same-origin form navigation.
  return (!headers.origin || headers.origin === 'null') && headers['sec-fetch-site'] === 'same-origin'
    && headers['sec-fetch-mode'] === 'navigate' && headers['sec-fetch-dest'] === 'document';
}

export function localRecoveryOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || !(host === 'localhost' || isIP(host) && isLoopbackAddress(host))) return null;
    return url.origin;
  } catch { return null; }
}

export function serverRecoveryTarget(host: string, port: number, currentHost: string): string | null {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid recovery port.');
  if (!port) return null; // The new OS-selected port is only known after the old process has exited.
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) return null;
  const ipv6 = host.includes(':');
  const browserHost = currentHost === 'localhost' ? 'localhost'
    : host === '0.0.0.0' && isIP(currentHost) === 4 && isLoopbackAddress(currentHost) ? currentHost
    : ipv6 ? '::1' : '127.0.0.1';
  return localRecoveryOrigin(`http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${port}`);
}

const recoveryCopy = {
  en: ['Restarting Virelo…', 'Waiting for the server to reconnect.', 'Restart was not confirmed.', 'The server will choose a new port.', 'Check the terminal or run', 'Try again', 'Could not restart Virelo.'],
  ja: ['Vireloを再起動中…', 'サーバーに再接続しています。', '再起動を確認できませんでした。', 'サーバーが新しいポートを自動で選びます。', 'ターミナルを確認するか、次のコマンドを実行してください：', '再試行', 'Vireloを再起動できませんでした。'],
  'zh-CN': ['正在重启 Virelo…', '正在重新连接服务器。', '未能确认服务器已重启。', '服务器将自动选择新的端口。', '请查看终端或运行', '重试', '无法重启 Virelo。'],
  ko: ['Virelo를 다시 시작하는 중…', '서버에 다시 연결하는 중입니다.', '서버가 다시 시작되었는지 확인할 수 없습니다.', '서버가 새 포트를 자동으로 선택합니다.', '터미널을 확인하거나 다음 명령을 실행하세요:', '다시 시도', 'Virelo를 다시 시작할 수 없습니다.'],
  ru: ['Перезапуск Virelo…', 'Ожидание подключения к серверу.', 'Не удалось подтвердить перезапуск.', 'Сервер автоматически выберет новый порт.', 'Проверьте терминал или выполните', 'Повторить', 'Не удалось перезапустить Virelo.']
} as const;

// A separate document grants connect permission to exactly one local origin, not to normal app pages.
export function serverRecoveryPage(target: string | null, challenge: string, previous: string, proof: string | null, language: unknown) {
  if (target !== null && localRecoveryOrigin(target) !== target) throw new Error('Invalid recovery address.');
  const locale = isLocale(language) ? language : 'en', copy = recoveryCopy[locale];
  const nonce = randomBytes(24).toString('hex');
  return {
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'${target ? ' ' + target : ''}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    html: `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy[0]}</title>
<style>body{color:#eee;background:#101010;font:16px system-ui;max-width:38rem;margin:12vh auto;padding:2rem;line-height:1.6}button{color:inherit;background:#303030;border:1px solid #777;padding:.6rem 1rem;border-radius:.5rem}</style>
<main><h1>${copy[0]}</h1><p id="status" role="status">${copy[1]}</p><p id="help" hidden>${copy[4]} <code>npx virelo status</code>.</p><button id="retry" hidden>${copy[5]}</button></main>
<script nonce="${nonce}">
const target = ${JSON.stringify(target)}, expected = ${JSON.stringify(proof)};
const challenge = ${JSON.stringify(challenge)}, previous = ${JSON.stringify(previous)};
const copy = ${JSON.stringify(copy)};
const status = document.getElementById('status'), help = document.getElementById('help'), retry = document.getElementById('retry');
async function reconnect() {
  retry.hidden = true;
  status.textContent = copy[1];
  const deadline = Date.now() + 40000;
  while (target && Date.now() < deadline) {
    try {
      const response = await fetch(target + '/server-ready?challenge=' + challenge + '&previous=' + previous, {credentials:'omit', cache:'no-store', redirect:'error', signal:AbortSignal.timeout(1500)});
      const state = response.ok && await response.json();
      if (expected && state && state.proof === expected) {
        location.replace(target + '/settings#server'); return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  status.textContent = target ? copy[2] : copy[3];
  help.hidden = false; retry.hidden = !target;
}
retry.addEventListener('click', reconnect);
(async () => {
  try {
    const response = await fetch('/api/server/management/restart', {method:'POST', headers:{'X-Virelo-Request':'1'}, signal:AbortSignal.timeout(10000)});
    if (!response.ok) { const body = await response.json(); throw new Error(body.error || copy[6]); }
    await reconnect();
  } catch (error) { status.textContent = error.message || copy[2]; help.hidden = false; retry.hidden = !target; }
})();
</script></html>`
  };
}
