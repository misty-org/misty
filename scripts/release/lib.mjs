import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
export const root = resolve(import.meta.dirname, '../..');
export const readJSON = file => JSON.parse(readFileSync(file,'utf8'));
export const writeJSON = (file, data) => writeFileSync(file, JSON.stringify(data,null,2)+'\n');
export const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export const run = (command,args,cwd=root,env={}) => execFileSync(command,args,{cwd,env:{...process.env,...env},stdio:'inherit'});
export const capture = (command,args,cwd=root) => execFileSync(command,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export function version(value) { if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(value)) throw new Error('Use a version such as 0.1.0-beta.1.'); return value; }
export function files(directory) { return readdirSync(directory,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(resolve(directory,e.name)) : e.isFile() ? [resolve(directory,e.name)] : []); }
export function checksums(directory) {
  mkdirSync(directory,{recursive:true});
  const entries = files(directory).filter(f => !f.endsWith('/SHA256SUMS')).sort();
  writeFileSync(resolve(directory,'SHA256SUMS'),entries.map(f => `${sha256(f)}  ${f.slice(directory.length+1)}`).join('\n')+'\n');
}
export function verifyChecksums(directory) {
  for (const line of readFileSync(resolve(directory,'SHA256SUMS'),'utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_./-]+)$/.exec(line);
    if (!match || match[2].split('/').includes('..') || match[2].startsWith('/')) throw new Error('Invalid checksum manifest.');
    if (sha256(resolve(directory,match[2])) !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
  }
}
