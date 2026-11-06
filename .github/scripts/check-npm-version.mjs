import { execSync } from 'node:child_process';

const REQUIRED = [11, 5, 1];
const version = execSync('npm --version', { encoding: 'utf8' }).trim();
const parts = version.split('.').map(Number);
const first = REQUIRED.findIndex((value, i) => parts[i] !== value);
const newEnough = first < 0 || parts[first] > REQUIRED[first];
console.log(`npm ${version}, trusted publishing needs ${REQUIRED.join('.')} or later`);
process.exitCode = newEnough ? 0 : 1;
