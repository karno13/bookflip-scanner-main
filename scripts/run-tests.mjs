import { spawn } from 'node:child_process';

const child = spawn(process.execPath, [
  '--import', new URL('./isolated-runtime.mjs', import.meta.url).href,
  '--test', '--test-timeout=30000', ...process.argv.slice(2),
], { stdio: 'inherit', windowsHide: true });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
