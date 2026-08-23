import { spawn } from 'node:child_process';

let shuttingDown = false;
const children = [];

function start(name, args) {
  const child = spawn('pnpm', args, { stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code, signal) => {
    const index = children.indexOf(child);
    if (index >= 0) children.splice(index, 1);
    if (shuttingDown || signal === 'SIGINT' || signal === 'SIGTERM') {
      return;
    }
    if (name === 'api') {
      console.error('API exited unexpectedly. Restarting in 1s…');
      setTimeout(() => start('api', ['--filter', '@vip/api', 'dev']), 1000);
      return;
    }
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}. The other app will keep running.`);
    }
  });
  return child;
}

start('api', ['--filter', '@vip/api', 'dev']);
start('web', ['--filter', '@vip/web', 'dev']);

function shutdown(signal) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
