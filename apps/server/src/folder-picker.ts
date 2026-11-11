import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { AccountError } from './accounts.js';
import { windowsFolderPicker } from './windows-folder-picker.js';

const macDialog = `try
  POSIX path of (choose folder with prompt "Choose a media folder for Virelo")
on error number -128
  return ""
end try`;

export async function pickNativeFolder(signal: AbortSignal, run = promisify(execFile), platform = process.platform): Promise<string | null> {
  const options = { encoding: 'utf8' as const, windowsHide: true, shell: false, timeout: 300_000, maxBuffer: 64 * 1024, signal };
  try {
    let stdout: string;
    if (platform === 'win32') {
      ({ stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(windowsFolderPicker, 'utf16le').toString('base64')], options));
    } else if (platform === 'darwin') {
      ({ stdout } = await run('/usr/bin/osascript', ['-e', macDialog], options));
    } else {
      try {
        ({ stdout } = await run('zenity', ['--file-selection', '--directory', '--title=Choose a media folder for Virelo'], options));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        ({ stdout } = await run('kdialog', ['--getexistingdirectory', '.', '--title', 'Choose a media folder for Virelo'], options));
      }
    }
    const output = stdout.replace(/[\r\n]+$/, '');
    if (!output) return null;
    const path: unknown = platform === 'win32' ? JSON.parse(output) : output;
    if (typeof path !== 'string' || !isAbsolute(path) || !(await stat(path)).isDirectory()) throw new Error('Invalid folder');
    return path;
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; killed?: boolean };
    if (platform !== 'win32' && platform !== 'darwin' && failure.code === 1 && !failure.stderr?.trim() && !failure.killed && !signal.aborted) return null;
    throw new AccountError('Could not open the folder chooser. Close any open chooser and try again, or enter the folder path manually.', 503);
  }
}
