import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const origin = 'https://apps.mistysys.com';
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');

// Preserve the live catalog's exact archives on the first beta too, when no
// previous beta-site archive exists. Never rewrite an existing version's bytes.
export async function preserveAppAssets(catalog, output, fetcher = fetch) {
  if (!Array.isArray(catalog.apps)) throw new Error('Invalid live app catalog.');
  for (const app of catalog.apps) {
    if (app.desktop?.runtime !== 'downloaded') continue;
    if (!/^[a-z][a-z0-9-]*$/.test(app.id) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(app.version))
      throw new Error('Invalid live app identity.');
    const relative = `official-apps/${app.id}/${app.version}/desktop.zip`;
    const expectedURL = `${origin}/${relative}`;
    if (app.desktop.entry !== expectedURL || !/^[a-f0-9]{64}$/.test(app.desktop.sha256))
      throw new Error(`Invalid live package metadata: ${app.id}`);
    const destination = resolve(output, relative);
    let bytes;
    if (existsSync(destination)) {
      bytes = readFileSync(destination);
    } else {
      const response = await fetcher(expectedURL, { signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error(`Cannot retain published package: ${app.id}/${app.version}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (checksum(bytes) !== app.desktop.sha256)
      throw new Error(`Published package bytes changed: ${app.id}/${app.version}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
}
