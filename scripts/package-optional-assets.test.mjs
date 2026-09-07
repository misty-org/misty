import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packageOptionalAssets} from './package-optional-assets.mjs';

test('packages immutable optional assets and rejects missing permissions, tampering and unsafe paths', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'misty-optional-assets-'));
  const input=path.join(root,'input'),output=path.join(root,'output');
  const bytes=Buffer.from('wOF2fixture'),hash=createHash('sha256').update(bytes).digest('hex');
  const key=`official-app-assets/journal/${hash}.woff2`;
  const license=Buffer.from('Font license fixture');
  const manifest={schemaVersion:1,appId:'journal',origins:['https://apps.mistysys.com'],assets:[{key,sha256:hash,bytes:bytes.length}],license:{key:'official-app-assets/journal/Xiaolai-OFL.txt',sha256:createHash('sha256').update(license).digest('hex'),bytes:license.length}};
  const app={id:'journal',scopes:['network.fetch','storage.read','storage.write']};
  const save=()=>writeFile(path.join(input,'optional-assets.json'),JSON.stringify(manifest));
  try {
    await mkdir(path.dirname(path.join(input,key)),{recursive:true});
    await writeFile(path.join(input,key),bytes);await writeFile(path.join(input,manifest.license.key),license);await save();
    await assert.rejects(packageOptionalAssets(input,output,{...app,scopes:[]}),/reviewed/);
    await packageOptionalAssets(input,output,app);
    assert.deepEqual(await readFile(path.join(output,key)),bytes);
    await packageOptionalAssets(input,output,app);
    await writeFile(path.join(output,key),'changed');
    await assert.rejects(packageOptionalAssets(input,output,app),/immutable/);
    await writeFile(path.join(output,key),bytes);await writeFile(path.join(input,key),'corrupt');
    await assert.rejects(packageOptionalAssets(input,output,app),/verification/);
    manifest.assets[0].key='../escape';await save();
    await assert.rejects(packageOptionalAssets(input,output,app),/path/);
  } finally {await rm(root,{recursive:true,force:true});}
});
