// Local integration fixture, not a production S3 server. AWS signing is tested by the server package.
import { createServer } from 'node:https';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'misty-journal-object-fixture-'));
await chmod(directory, 0o700);
const keyFile = join(directory, 'key.pem'), caFile = join(directory, 'ca.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', caFile,
  '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-days', '1'], { stdio: 'ignore' });
await chmod(keyFile, 0o600);
const controlToken = randomBytes(32).toString('hex');
const accessKeyId = `MISTY${randomBytes(8).toString('hex').toUpperCase()}`;
const secretAccessKey = randomBytes(32).toString('hex');
const objects = new Map(), requests = [];
let corruptNextRead = false;
const bucket = 'misty-sdk-fixture';
const maxBytes = 15 * 1024 * 1024;
const server = createServer({ key: await readFile(keyFile), cert: await readFile(caFile) }, async (request, response) => {
  try {
    const url = new URL(request.url, 'https://127.0.0.1');
    if (url.pathname === '/__fixture__/corrupt-next-read' && request.method === 'POST') {
      if (request.headers.authorization !== `Bearer ${controlToken}`) { response.writeHead(403).end(); return; }
      corruptNextRead = true; response.writeHead(204).end(); return;
    }
    if (url.pathname === '/__fixture__/stats') {
      if (request.headers.authorization !== `Bearer ${controlToken}`) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ objects: objects.size, requests })); return;
    }
    if (!url.pathname.startsWith(`/${bucket}/`)) { response.writeHead(404).end(); return; }
    const signedQuery = url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256' &&
      url.searchParams.get('X-Amz-Credential')?.startsWith(`${accessKeyId}/`) && /^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') ?? '');
    const signedHeader = request.headers.authorization?.startsWith(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/`);
    if (!signedQuery && !signedHeader) { response.writeHead(403).end(); return; }
    if (request.headers.cookie || request.headers['x-misty-library-upload-token'] || request.headers.authorization?.startsWith('Bearer '))
      throw new Error('Host credentials were forwarded to object storage.');
    // No credentials, signatures, URLs or raw document bytes are recorded in request summaries.
    requests.push({ method: request.method, path: url.pathname, querySigned: !!signedQuery, headerSigned: !!signedHeader });
    if (requests.length > 512) requests.shift();
    if (request.method === 'PUT') {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) { response.writeHead(413).end(); request.destroy(); return; }
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const metadata = Object.fromEntries(Object.entries(request.headers).filter(([key]) => key.startsWith('x-amz-meta-')));
      for (const [key, value] of url.searchParams) if (key.toLowerCase().startsWith('x-amz-meta-')) metadata[key.toLowerCase()] = value;
      const type = request.headers['content-type'] ?? url.searchParams.get('Content-Type') ?? 'application/octet-stream';
      const etag = `"${createHash('md5').update(bytes).digest('hex')}"`;
      objects.set(url.pathname, { bytes, metadata, type, etag });
      response.setHeader('ETag', etag); response.writeHead(200).end(); return;
    }
    if (request.method === 'DELETE') { objects.delete(url.pathname); response.writeHead(204).end(); return; }
    const object = objects.get(url.pathname);
    if (!object) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Length', object.bytes.length);
    response.setHeader('Content-Type', object.type);
    response.setHeader('ETag', object.etag);
    for (const [key, value] of Object.entries(object.metadata)) response.setHeader(key, value);
    if (request.method === 'HEAD') { response.writeHead(200).end(); return; }
    if (request.method === 'GET') {
      const bytes = Buffer.from(object.bytes);
      if (corruptNextRead && bytes.length) { bytes[0] ^= 1; corruptNextRead = false; }
      response.writeHead(200).end(bytes); return;
    }
    response.writeHead(405).end();
  } catch (error) {
    // Never echo transfer URLs or authorization headers to client logs.
    requests.push({ error: error instanceof Error && error.message === 'Host credentials were forwarded to object storage.' ? 'credential_leak' : 'fixture_request_failed' });
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `https://127.0.0.1:${server.address().port}`;
const configurationPath = join(directory, 'configuration.json');
await writeFile(configurationPath, JSON.stringify({ endpoint, caFile, accessKeyId, secretAccessKey, bucket, region: 'auto', controlToken, pid: process.pid }), { mode: 0o600 });
process.stdout.write(`Local HTTPS object fixture configuration: ${configurationPath}\n`);
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  objects.clear();
  await rm(directory, { recursive: true, force: true });
};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)); });
