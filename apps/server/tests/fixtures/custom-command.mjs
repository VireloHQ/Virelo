import { spawn } from 'node:child_process';

const [mode, ...args] = process.argv.slice(2);
if (mode === 'echo') {
  console.log(JSON.stringify(args));
} else if (mode === 'exit') {
  console.error('Tool rejected its configuration.');
  process.exitCode = 7;
} else {
  if (mode === 'tree' || mode === 'tree-stubborn') {
    const child = spawn(process.execPath, ['-e', `${mode === 'tree-stubborn' ? "process.on('SIGTERM',()=>{});" : ''}console.log('ready');setInterval(()=>{},1000)`], { windowsHide:true });
    child.stdout.once('data', () => console.log('CHILD=' + child.pid));
  }
  if (mode === 'noisy') console.log('x'.repeat(100_000));
  console.error('\x1b[31mLocal test tool\x1b[0m');
  console.log('https://outside.example/');
  console.log('https://wrong.share.example.attacker.test/');
  console.log('https://user:password@secret.share.example/');
  console.log('https://query.share.example/?token=private');
  console.log('https://ready.share.example/');
  console.log('READY=' + JSON.stringify(args));
  setInterval(() => {}, 1000);
}
