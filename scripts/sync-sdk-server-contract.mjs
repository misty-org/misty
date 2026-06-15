import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mistyServerMethods as methods } from '../../misty-sdk/packages/contracts/dist/index.js';
const root = resolve(import.meta.dirname, '..');
const target = resolve(root, '../misty-server/internal/apprpc/methods.json');
const contents = JSON.stringify({ protocol: 2, methods }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== contents) throw new Error('SDK and server method contracts differ. Run node scripts/sync-sdk-server-contract.mjs.');
} else {
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}
console.log(`${Object.keys(methods).length} SDK/server method contracts ${process.argv.includes('--check') ? 'match' : 'synchronized'}.`);
