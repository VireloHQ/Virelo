import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import open from 'open';
import { readRecentLog, sendControl, type ControlProfile, type ServerSnapshot } from './server-control.js';

type View = 'overview' | 'libraries' | 'logs' | 'settings';
const MIN_TERMINAL_WIDTH = 48;

export function terminalMediaPath(value: string, cwd = process.cwd()): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') || raw.startsWith('~\\') ? join(homedir(), raw.slice(2)) : raw;
  return resolve(cwd, expanded);
}

export async function openTerminalUI(profile: ControlProfile, initial: ServerSnapshot, upgradeNotice = false, acknowledgeUpgrade?: () => Promise<void>): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') {
    process.stdout.write(`Virelo running: ${initial.url}\nUse \"virelo status\" to check and \"virelo stop\" to stop it.\n`);
    return;
  }
  const stdin = process.stdin;
  const stdout = process.stdout;
  const colors = !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0';
  const glyphs = (process.env.LC_ALL || process.env.LANG || '').toUpperCase().includes('ASCII') ? false : true;
  const muted = (s: string) => colors ? `\x1b[38;5;245m${s}\x1b[0m` : s;
  const borderChars = glyphs ? { tl: '╭', tr: '╮', bl: '╰', br: '╯', hz: '─', vt: '│' } : { tl: '+', tr: '+', bl: '+', br: '+', hz: '-', vt: '|' };
  let view: View = 'overview';
  let selection = 0;
  let status = initial;
  let notice = upgradeNotice ? 'Virelo no longer scans the current folder automatically. Use --here to include it.' : '';
  let confirmStop = false;
  let waitingForUpgrade = upgradeNotice;
  let closed = false;
  let busy = false;
  let logs = '';
  const actions = ['Open Web UI', 'Libraries', 'Scan libraries', 'Server logs', 'Settings', 'Detach TUI', 'Stop server'];
  const output = (s: string) => stdout.write(s);
  const fit = (s: string, max: number) => {
    // Media names and log entries are untrusted; never echo terminal control codes.
    const clean = s.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ');
    return clean.length > max ? clean.slice(0, Math.max(0, max - 1)) + '…' : clean;
  };
  const line = (text: string, width: number) => {
    // Single-width terminal input: printable ASCII plus simple Unicode box glyphs.
    const content = fit(text, width - 4);
    return `${borderChars.vt}  ${content.padEnd(Math.max(0, width - 4))}${borderChars.vt}`;
  };
  const frame = (lines: string[], width: number) => {
    const top = borderChars.tl + borderChars.hz.repeat(width - 2) + borderChars.tr;
    const bottom = borderChars.bl + borderChars.hz.repeat(width - 2) + borderChars.br;
    return [top, ...lines.map(s => line(s, width)), bottom].join('\n');
  };
  const paint = () => {
    if (closed) return;
    const width = Math.max(12, Math.min(stdout.columns || 84, 106));
    const compact = (stdout.columns || 84) < MIN_TERMINAL_WIDTH;
    const display: string[] = [];
    const uptime = Math.max(0, Math.floor((Date.now() - status.startedAt) / 1000));
    const clock = uptime >= 3600 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
    display.push('');
    display.push('  VIRELO                                      SERVER CONSOLE');
    display.push('  ' + (glyphs ? '●' : '*') + ' Online       ' + status.version + '      PID ' + status.pid);
    display.push('');
    display.push('  Local       ' + fit(status.url, width - 18));
    display.push('  Uptime      ' + clock);
    display.push('  Libraries   ' + status.libraries + ' active');
    display.push('  Scan        ' + (status.scanRunning ? 'Running' : 'Idle'));
    display.push('');
    if (waitingForUpgrade) {
      display.push('  YOUR LIBRARY, YOUR CHOICE');
      display.push('  Virelo now starts without scanning your current directory.');
      display.push('  Your saved libraries have not changed.');
      display.push('  Use --here to add the current directory for a server run.');
      display.push('  You can also add folders in the Web UI.');
      display.push('  Press Enter to continue.');
    } else if (confirmStop) {
      display.push('  Stop Virelo server? Connected viewers will disconnect.');
      display.push('  Press Y to stop, N or Esc to cancel.');
    } else if (view === 'overview') {
      display.push('  QUICK ACTIONS');
      for (let i = 0; i < actions.length; i++) display.push(`  ${selection === i ? '>' : ' '}  ${actions[i]}`);
    } else if (view === 'libraries') {
      display.push('  LIBRARIES');
      display.push('  ' + status.libraries + ' active libraries');
      display.push('  Add temporary media with a path using [a].');
      display.push('  Permanent libraries: Web UI > Settings > Libraries.');
      display.push('  [Esc] Back   [o] Open Web UI');
    } else if (view === 'settings') {
      display.push('  SERVER');
      display.push('  Host        ' + status.host);
      display.push('  Port        ' + status.port);
      display.push('  Data        ' + fit(status.dataDir, width - 18));
      display.push('  For OS-managed autostart, use a supported system service.');
      display.push('  [Esc] Back');
    } else {
      display.push('  RECENT LOGS');
      const logWidth = Math.max(0, width - 10);
      for (const entry of logs.split(/\r?\n/).filter(Boolean).slice(-Math.max(3, (stdout.rows || 28) - 17)))
        display.push('  ' + fit(entry.replace(/\x1b\[[0-9;]*m/g, ''), logWidth));
      if (!logs.trim()) display.push('  No logs yet.');
      display.push('  [Esc] Back');
    }
    if (notice) { display.push(''); display.push('  ' + fit(notice, width - 7)); }
    const maxLines = Math.max(7, (stdout.rows || 30) - 3);
    const terminalLines = display.slice(0, maxLines);
    const picture = frame(terminalLines, width);
    const accent = (value: string) => colors ? '\x1b[38;5;111m' + value + '\x1b[0m' : value;
    const title = (value: string) => colors ? '\x1b[1;38;5;255m' + value + '\x1b[0m' : value;
    const styled = picture.split('\n').map((row, i, all) => {
      if (i === 0 || i === all.length - 1) return accent(row);
      const parts = row.match(/^(.)(.*)(.)$/u);
      if (!parts) return row;
      const content = parts[2].replace('VIRELO', title('VIRELO')).replace('● Online', colors ? '\x1b[38;5;121m● Online\x1b[0m' : '● Online');
      return accent(parts[1]) + content + accent(parts[3]);
    }).join('\n');
    output('\x1b[H\x1b[J' + styled + '\n' + muted(compact ? ' Resize terminal for a wider view.  Q Detach' : ' ↑↓ Select   Enter Open   O Browser   Q Detach   X Stop') + '\x1b[J');
  };
  const updateStatus = async () => {
    const reply = await sendControl(profile, { action: 'status' }).catch(() => null);
    if (!reply?.ok) notice = 'Server disconnected. Press Q to close this console.';
    else status = reply.status;
    if (view === 'logs') logs = await readRecentLog(profile).catch(() => '');
    paint();
  };
  const finish = () => { if (closed) return; closed = true; clearInterval(tick); stdin.off('keypress', onKey); stdout.off('resize', paint); if (stdin.isRaw) stdin.setRawMode(false); stdin.pause(); output('\x1b[?25h\x1b[?1049l'); };
  const run = async (action: string) => {
    if (busy) return;
    busy = true;
    try {
      if (action === 'Open Web UI') await open(status.url);
      else if (action === 'Libraries') view = 'libraries';
      else if (action === 'Scan libraries') {
        const response = await sendControl(profile, { action: 'scan' });
        notice = response?.ok ? response.message || 'Library scan requested.' : response?.error || 'Server offline.';
      } else if (action === 'Server logs') { view = 'logs'; logs = await readRecentLog(profile); }
      else if (action === 'Settings') view = 'settings';
      else if (action === 'Detach TUI') finish();
      else if (action === 'Stop server') confirmStop = true;
    } catch (error) { notice = error instanceof Error ? error.message : String(error); }
    finally { busy = false; paint(); }
  };
  const addLibrary = async () => {
    if (busy) return;
    busy = true;
    if (stdin.isRaw) stdin.setRawMode(false);
    output('\x1b[?1049l\x1b[?25h');
    const input = createInterface({ input: stdin, output: stdout });
    try {
      const path = terminalMediaPath(await input.question('Media folder path (temporary; blank to cancel): '));
      if (path) {
        const result = await sendControl(profile, { action: 'addMedia', path });
        notice = result?.ok ? result.message || 'Folder added for this run.' : result?.error || 'Could not reach server.';
      }
    } catch { notice = 'Folder selection cancelled.'; }
    finally {
      input.close();
      if (!closed) { stdin.setRawMode(true); stdin.resume(); output('\x1b[?1049h\x1b[?25l'); }
      busy = false;
      paint();
    }
  };
  const onKey = (_value: string, key: { name?: string; ctrl?: boolean }) => {
    if (busy || closed) return;
    if (key.ctrl && key.name === 'c') { finish(); return; }
    if (waitingForUpgrade) {
      if (key.name === 'return') {
        waitingForUpgrade = false;
        notice = '';
        if (acknowledgeUpgrade) void acknowledgeUpgrade().catch(() => { notice = 'Could not save the upgrade acknowledgement.'; paint(); });
      }
      paint(); return;
    }
    if (confirmStop) {
      if (key.name === 'y') {
        confirmStop = false;
        void sendControl(profile, { action: 'stop' }).finally(finish);
      } else if (key.name === 'n' || key.name === 'escape') confirmStop = false;
      paint(); return;
    }
    if (key.name === 'q') { finish(); return; }
    if (key.name === 'o') { void run('Open Web UI'); return; }
    if (key.name === 'x') { confirmStop = true; paint(); return; }
    if (key.name === 'escape') { view = 'overview'; paint(); return; }
    if (view === 'libraries' && key.name === 'a') { void addLibrary(); return; }
    if (view !== 'overview') return;
    if (key.name === 'up') selection = (selection + actions.length - 1) % actions.length;
    else if (key.name === 'down') selection = (selection + 1) % actions.length;
    else if (key.name === 'return') { void run(actions[selection]); return; }
    paint();
  };
  stdin.setRawMode(true);
  emitKeypressEvents(stdin);
  stdin.on('keypress', onKey);
  stdin.resume();
  output('\x1b[?1049h\x1b[?25l');
  stdout.on('resize', paint);
  const tick = setInterval(() => { void updateStatus(); }, 1800);
  paint();
  await new Promise<void>(resolve => {
    const poll = setInterval(() => {
      if (closed) { clearInterval(poll); resolve(); }
    }, 100);
  });
}
