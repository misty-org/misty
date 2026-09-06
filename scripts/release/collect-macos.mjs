import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { root, readJSON, writeJSON, files, run, version, sha256 } from './lib.mjs';
const target = process.argv[2];
if (!['aarch64-apple-darwin','x86_64-apple-darwin'].includes(target)) throw new Error('Choose a supported macOS target.');
const arch = target.split('-')[0];
const releaseVersion = version(readJSON(resolve(root,'package.json')).version);
const bundle = resolve(root,'src-tauri/target',target,'release/bundle');
const app = resolve(bundle,'macos/Misty.app');
run('codesign',['--verify','--deep','--strict','--verbose=2',app]);
run('xcrun',['stapler','validate',app]);
run('spctl',['--assess','--type','execute','--verbose=2',app]);
const binary = captureArchitecture(app);
if (!binary.includes(arch === 'aarch64' ? 'arm64' : 'x86_64')) throw new Error('Wrong application architecture.');
const output = resolve(root,'artifacts',`v${releaseVersion}`); mkdirSync(output,{recursive:true});
const dmg = files(bundle).filter(p=>p.endsWith('.dmg'));
if (dmg.length !== 1) throw new Error('Expected one signed installer.');
run('codesign',['--verify','--strict','--verbose=2',dmg[0]]);
run('xcrun',['stapler','validate',dmg[0]]);
run('spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=2',dmg[0]]);
const names = [
  [dmg[0],`Misty-${releaseVersion}-${arch}.dmg`],
  [resolve(bundle,'macos/Misty.app.tar.gz'),`Misty-${releaseVersion}-${arch}.app.tar.gz`],
  [resolve(bundle,'macos/Misty.app.tar.gz.sig'),`Misty-${releaseVersion}-${arch}.app.tar.gz.sig`],
];
for (const [source,name] of names) copyFileSync(source,resolve(output,name));
writeJSON(resolve(output,`verification-${arch}.json`),{target,version:releaseVersion,signatureVerified:true,notarizationVerified:true,gatekeeperAccepted:true,interactiveInstallVerified:false,files:names.map(([,name])=>({name,sha256:sha256(resolve(output,name))}))});
import { execFileSync } from 'node:child_process';
function captureArchitecture(path) { return execFileSync('lipo',['-archs',resolve(path,'Contents/MacOS/misty-desktop')],{encoding:'utf8'}); }
