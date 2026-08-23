import { spawn } from 'node:child_process';

const children = [
  spawn('pnpm', ['--filter', '@vip/api', 'dev'], { stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@vip/web', 'dev'], { stdio: 'inherit' }),
];

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      return;
    }
    if (code && code !== 0) {
      console.error(`A workspace process exited with code ${code}. The other app will keep running.`);
    }
  });
}
