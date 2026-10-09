// Runs every unit test in tests/unit with Node's built-in test runner.
// tsx strips the TypeScript; no test framework dependency needed.

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './shared.mjs';

const dir = path.join(ROOT, 'tests', 'unit');
const files = (await readdir(dir))
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error('No unit tests found in tests/unit');
  process.exit(1);
}

const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
