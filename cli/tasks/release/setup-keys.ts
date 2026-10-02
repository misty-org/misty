import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const directory = resolve(homedir(), '.config/misty-release');
mkdirSync(directory, {recursive:true, mode:0o700});
chmodSync(directory, 0o700);
const updaterPath = resolve(directory, 'updater.key');
const trustPath = resolve(root, 'release/trust.json');
if (existsSync(trustPath) && !existsSync(updaterPath))
  throw new Error('Restore the release updater key from your secure backup.');
if (!existsSync(updaterPath)) execFileSync(resolve(root,'node_modules/.bin/tauri'), ['signer','generate','--ci','-w',updaterPath], {stdio:'ignore'});
chmodSync(updaterPath,0o600);
const updaterPublicKey = readFileSync(`${updaterPath}.pub`,'utf8').trim();
if (existsSync(trustPath) && JSON.parse(readFileSync(trustPath,'utf8')).updaterPublicKey !== updaterPublicKey)
  throw new Error('Local updater key does not match committed release trust.');
mkdirSync(resolve(root,'release'),{recursive:true});
writeFileSync(trustPath,JSON.stringify({updaterPublicKey},null,2)+'\n');
const configPath = resolve(root,'src-tauri/tauri.conf.json');
const config = JSON.parse(readFileSync(configPath,'utf8'));
config.plugins.updater.pubkey = updaterPublicKey;
writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
const envDirectory = resolve(root, 'cli/.env');
mkdirSync(envDirectory, {recursive:true, mode:0o700});
const envPath = resolve(envDirectory, 'release.env');
const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const retained = existing.split('\n').filter(line => !/^TAURI_(SIGNING_PRIVATE_KEY|UPDATER_PUBLIC_KEY)=/.test(line));
retained.push(`TAURI_SIGNING_PRIVATE_KEY=${JSON.stringify(updaterPath)}`);
retained.push(`TAURI_UPDATER_PUBLIC_KEY=${JSON.stringify(updaterPublicKey)}`);
writeFileSync(envPath, retained.filter(Boolean).join('\n') + '\n', {mode:0o600});
chmodSync(envPath, 0o600);
console.log(`Release keys match committed trust. Local configuration saved to ${envPath}; no GitHub secrets are needed.`);
