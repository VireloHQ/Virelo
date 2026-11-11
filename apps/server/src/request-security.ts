import { isIP } from 'node:net';

export function requestHostname(authority: string): string {
  const match = /^(?:\[([a-f\d:.]+)\]|([a-z\d.-]+))(?::(\d{1,5}))?$/i.exec(authority);
  if (!match || (match[3] !== undefined && Number(match[3]) > 65535)) return '';
  const hostname = (match[1] ?? match[2]).toLowerCase().replace(/\.$/, '');
  if (match[1]) return isIP(hostname) === 6 ? new URL(`http://[${hostname}]`).hostname.slice(1, -1) : '';
  if (hostname.length > 253 || !hostname.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return '';
  return hostname;
}

export function isLoopbackAddress(address: string): boolean {
  if (isIP(address) === 4) return address.startsWith('127.');
  if (isIP(address) !== 6) return false;
  const normalized = requestHostname(`[${address}]`);
  return normalized === '::1' || /^::ffff:7f[\da-f]{2}:[\da-f]+$/i.test(normalized);
}

export function isTrustedHostname(host: string, configHost: string, trusted: readonly string[]): boolean {
  if (trusted.includes(host)) return true;
  if (!['0.0.0.0', '::'].includes(configHost) && host === configHost.toLowerCase()) return true;
  const family = isIP(host);
  if (family === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 127 || first === 10 || first === 192 && second === 168
      || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31
      || first === 100 && second >= 64 && second <= 127;
  }
  if (family === 6) return host === '::1' || /^(?:f[cd][\da-f]{2}|fe[89ab][\da-f]):/i.test(host);
  // Address prefixes must never grant trust to DNS names such as 10.example.com.
  return host === 'localhost' || host.endsWith('.local') || /^[a-z\d-]+$/i.test(host) && !/^\d+$/.test(host);
}
