import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Release scripts execute directly in Node.
import { preserveAppAssets } from './preserve-app-assets.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'misty-retain-')); roots.push(root);
  const bytes = Buffer.from('previously published archive');
  const app = { id: 'code', version: '1.0.0', desktop: { runtime: 'downloaded', entry: 'https://apps.mistysys.com/official-apps/code/1.0.0/desktop.zip', sha256: createHash('sha256').update(bytes).digest('hex') } };
  return { root, bytes, app, path: resolve(root, 'official-apps/code/1.0.0/desktop.zip') };
}
it('retains the live package on a first beta with no previous beta archive', async () => {
  const f = fixture();
  await preserveAppAssets({ apps: [f.app] }, f.root, async () => new Response(f.bytes));
  expect(readFileSync(f.path)).toEqual(f.bytes);
  const fetcher = vi.fn();
  await preserveAppAssets({ apps: [f.app] }, f.root, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects changed bytes at a published version and corrupted downloads', async () => {
  const f = fixture();
  await expect(preserveAppAssets({ apps: [f.app] }, f.root, async () => new Response('corrupt'))).rejects.toThrow('Published package bytes changed');
  mkdirSync(dirname(f.path), { recursive: true }); writeFileSync(f.path, 'conflicting candidate');
  await expect(preserveAppAssets({ apps: [f.app] }, f.root, vi.fn())).rejects.toThrow('Published package bytes changed');
  expect(readFileSync(f.path, 'utf8')).toBe('conflicting candidate');
});
it('rejects foreign URLs before downloading anything', async () => {
  const f = fixture(), fetcher = vi.fn(); f.app.desktop.entry = 'https://other.example/desktop.zip';
  await expect(preserveAppAssets({ apps: [f.app] }, f.root, fetcher)).rejects.toThrow('Invalid live package metadata');
  expect(fetcher).not.toHaveBeenCalled();
});
