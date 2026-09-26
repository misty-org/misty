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
for (const [name,value] of Object.entries({TAURI_SIGNING_PRIVATE_KEY:readFileSync(updaterPath,'utf8')})) {
  execFileSync('gh',['secret','set',name,'--repo','misty-org/misty'],{input:value,stdio:['pipe','ignore','pipe']});
}
console.log(`Release keys match committed trust; private backups are in ${directory}. GitHub signing secrets are configured.`);
