import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  {
    name: 'version, docs, syntax, and tests',
    command: npm,
    args: ['run', 'check'],
  },
  {
    name: 'release documentation metadata',
    command: npm,
    args: ['run', 'check:docs:release'],
  },
  {
    name: 'security coverage',
    command: npm,
    args: ['run', 'coverage:security'],
  },
  {
    name: 'package dry run',
    command: npm,
    args: ['pack', '--dry-run'],
  },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${step.name}`);
    console.log(`$ ${[step.command, ...step.args].join(' ')}`);
    const child = spawn(step.command, step.args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

for (const step of steps) {
  await runStep(step);
}

console.log('\nRelease checks passed');
