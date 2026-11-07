// Stands in front of the throwaway server and writes down everything the app sends it, one JSON line
// per request or WebSocket message, so a step can say exactly what the server saw during a run. It never
// writes headers, so sign-in tokens stay out of the log.
//
//   node evals/smoke/server-log.mjs <listen port> <server port> <log file>
import { appendFileSync } from "node:fs";
import { createServer, request as forward } from "node:http";
import { connect } from "node:net";

const [listenPort, serverPort, file] = process.argv.slice(2);
const host = "127.0.0.1";
const keptBytes = 1 << 20;

// A throwaway account's password still stays out of a log.
const scrubbed = (body) => body.replace(/"password":"[^"]*"/g, '"password":"[kept out]"');
const note = (entry) => appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });

/** What a client sent over a WebSocket: its frames are masked, so they can't be read as they are. */
function webSocketReader(path) {
  let waiting = Buffer.alloc(0);
  return (chunk) => {
    waiting = Buffer.concat([waiting, chunk]);
    for (;;) {
      if (waiting.length < 2) return;
      const opcode = waiting[0] & 0x0f;
      const masked = Boolean(waiting[1] & 0x80);
      let length = waiting[1] & 0x7f;
      let at = 2;
      if (length === 126) {
        if (waiting.length < 4) return;
        length = waiting.readUInt16BE(2);
        at = 4;
      } else if (length === 127) {
        if (waiting.length < 10) return;
        length = Number(waiting.readBigUInt64BE(2));
        at = 10;
      }
      const mask = masked ? at : -1;
      if (masked) at += 4;
      if (waiting.length < at + length) return;
      const body = Buffer.from(waiting.subarray(at, at + length));
      if (masked) for (let index = 0; index < body.length; index++) body[index] ^= waiting[mask + index % 4];
      waiting = waiting.subarray(at + length);
      // Text, binary and continuation frames carry data; the rest only keep the line open.
      if (opcode <= 2) note({ method: "WS", path, body: body.toString("utf8", 0, Math.min(body.length, keptBytes)) });
    }
  };
}

const server = createServer((request, response) => {
  const chunks = [];
  let size = 0;
  let status = 0;
  const upstream = forward({ host, port: serverPort, method: request.method, path: request.url, headers: request.rawHeaders }, (answer) => {
    status = answer.statusCode ?? 502;
    response.writeHead(status, answer.rawHeaders);
    answer.pipe(response);
  });
  upstream.on("error", (error) => {
    console.error(`server-log: ${request.method} ${request.url}: ${error}`);
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });
  request.on("data", (chunk) => {
    if (size < keptBytes) chunks.push(chunk);
    size += chunk.length;
    upstream.write(chunk);
  });
  request.on("end", () => upstream.end());
  request.on("error", () => upstream.destroy());
  // Written once it's answered, so the log shows how each request ended.
  response.on("close", () => {
    upstream.destroy();
    note({ method: request.method, path: request.url, status, body: scrubbed(Buffer.concat(chunks).toString("utf8")) });
  });
});

server.on("upgrade", (request, client, head) => {
  note({ method: "UPGRADE", path: request.url, body: "" });
  const upstream = connect(Number(serverPort), host, () => {
    const lines = [`${request.method} ${request.url} HTTP/1.1`];
    for (let index = 0; index < request.rawHeaders.length; index += 2)
      lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    const read = webSocketReader(request.url);
    if (head.length) {
      read(head);
      upstream.write(head);
    }
    client.on("data", (chunk) => {
      read(chunk);
      upstream.write(chunk);
    });
    upstream.pipe(client);
  });
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  client.on("close", close);
  upstream.on("error", close);
  upstream.on("close", close);
});

server.listen(Number(listenPort), host);
