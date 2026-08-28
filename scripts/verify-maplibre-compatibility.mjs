import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'apps/mobile/verify-maplibre-compatibility.mjs');
const { stdout, stderr } = await run(process.execPath, [script]);
if (stderr) process.stderr.write(stderr);
process.stdout.write(stdout);
