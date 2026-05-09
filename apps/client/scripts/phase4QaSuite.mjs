import { execSync } from 'node:child_process';

const commands = [
  'npm run -s check:board-preview-integration',
  'npm run -s build'
];

for (const command of commands) {
  console.log(`\n[phase4] running: ${command}`);
  execSync(command, { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
}

console.log('\nPhase 4 QA suite passed.');
