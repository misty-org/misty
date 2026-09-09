import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checksums, verifyChecksums, version, verifyRepackedArchive } from './lib.mjs';
test('release verification rejects altered bytes and unsafe checksum paths', () => {
  const directory = mkdtempSync(resolve(tmpdir(),'misty-checksums-'));
  try {
    writeFileSync(resolve(directory,'app.zip'),'signed content');
    checksums(directory); verifyChecksums(directory);
    writeFileSync(resolve(directory,'app.zip'),'altered content');
    assert.throws(()=>verifyChecksums(directory),/mismatch/);
    writeFileSync(resolve(directory,'SHA256SUMS'),`${'a'.repeat(64)}  ../outside\n`);
    assert.throws(()=>verifyChecksums(directory),/Invalid/);
  } finally { rmSync(directory,{recursive:true}); }
});
test('release names cannot escape artifact directories or publish stable releases',()=>{
  assert.equal(version('0.1.0-beta.1'),'0.1.0-beta.1');
  for (const value of ['../beta','v0.1.0','0.1.0','1.0.0-beta.1;echo']) assert.throws(()=>version(value));
});

test('SDK repacking accepts compression differences and rejects changed content',()=>{
  const directory = mkdtempSync(resolve(tmpdir(),'misty-repack-'));
  const pinned = resolve(directory,'pinned.tgz'), rebuilt = resolve(directory,'rebuilt.tgz');
  try {
    const bytes = Buffer.from('package archive contents'.repeat(500));
    writeFileSync(pinned,gzipSync(bytes,{level:1}));
    writeFileSync(rebuilt,gzipSync(bytes,{level:9}));
    verifyRepackedArchive(pinned,rebuilt);
    writeFileSync(rebuilt,gzipSync(Buffer.from('modified package')));
    assert.throws(()=>verifyRepackedArchive(pinned,rebuilt),/does not reproduce/);
  } finally { rmSync(directory,{recursive:true}); }
});
