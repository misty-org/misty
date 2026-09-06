import { randomBytes, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const directory = resolve(homedir(), '.config/misty-release');
mkdirSync(directory, {recursive:true, mode:0o700});
chmodSync(directory, 0o700);
const seedPath = resolve(directory, 'official-apps.key');
const updaterPath = resolve(directory, 'updater.key');
const trustPath = resolve(root, 'release/trust.json');
// Never silently replace keys trusted by an existing release.
if (existsSync(trustPath) && (!existsSync(seedPath) || !existsSync(updaterPath)))
  throw new Error('Restore the release keys from your secure backup. Existing trust must not be replaced.');
if (!existsSync(seedPath)) writeFileSync(seedPath, randomBytes(32).toString('hex'), {mode:0o600});
if (!existsSync(updaterPath)) execFileSync(resolve(root,'node_modules/.bin/tauri'), ['signer','generate','--ci','-w',updaterPath], {stdio:'ignore'});
chmodSync(seedPath,0o600); chmodSync(updaterPath,0o600);
const seed = readFileSync(seedPath,'utf8').trim();
const privateKey = createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(seed,'hex')]),format:'der',type:'pkcs8'});
const publicKey = createPublicKey(privateKey).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
const updaterPublicKey = readFileSync(`${updaterPath}.pub`,'utf8').trim();
const trust = {keyId:'misty-official-2026-09', publicKey, updaterPublicKey};
if (existsSync(trustPath) && JSON.stringify(JSON.parse(readFileSync(trustPath,'utf8'))) !== JSON.stringify(trust))
  throw new Error('Local keys do not match committed release trust. Restore the matching keys.');
mkdirSync(resolve(root,'release'),{recursive:true});
writeFileSync(trustPath,JSON.stringify(trust,null,2)+'\n');
const configPath = resolve(root,'src-tauri/tauri.conf.json');
const config = JSON.parse(readFileSync(configPath,'utf8'));
config.plugins.updater.pubkey = updaterPublicKey;
writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
for (const [name,value] of Object.entries({MISTY_OFFICIAL_APP_SIGNING_PRIVATE_KEY:seed,TAURI_SIGNING_PRIVATE_KEY:readFileSync(updaterPath,'utf8')})) {
  execFileSync('gh',['secret','set',name,'--repo','misty-org/misty'],{input:value,stdio:['pipe','ignore','pipe']});
}
console.log(`Release keys match committed trust; private backups are in ${directory}. GitHub signing secrets are configured.`);
