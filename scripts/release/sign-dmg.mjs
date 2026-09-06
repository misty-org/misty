import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root, files, run } from './lib.mjs';
const target = process.argv[2];
if (!['aarch64-apple-darwin','x86_64-apple-darwin'].includes(target)) throw new Error('Invalid macOS target.');
const installers = files(resolve(root,'src-tauri/target',target,'release/bundle')).filter(p=>p.endsWith('.dmg'));
if (installers.length !== 1) throw new Error('Expected one installer.');
for (const key of ['APPLE_SIGNING_IDENTITY','APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID'])
  if (!process.env[key]) throw new Error(`Missing ${key}.`);
const dmg = installers[0];
run('codesign',['--force','--timestamp','--sign',process.env.APPLE_SIGNING_IDENTITY,dmg]);
// Avoid including credential-bearing arguments in a thrown child-process error.
const result = spawnSync('xcrun',['notarytool','submit',dmg,'--apple-id',process.env.APPLE_ID,'--password',process.env.APPLE_PASSWORD,'--team-id',process.env.APPLE_TEAM_ID,'--wait','--output-format','json'],{encoding:'utf8',timeout:30*60*1000});
let submission;
try { submission = JSON.parse(result.stdout); } catch {}
if (result.status !== 0 || submission?.status !== 'Accepted') throw new Error(`Installer notarization failed (${submission?.status || 'no accepted response'}). Inspect the Apple notarization history.`);
run('xcrun',['stapler','staple',dmg]);
