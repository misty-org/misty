import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openHabitAdapter } from "./adapter.mjs";

process.umask(0o077);
const token = process.env.HABITS_BACKEND_TOKEN;
if (!token || token.length < 32) throw new Error("Set HABITS_BACKEND_TOKEN to a private random credential of at least 32 characters.");
const digest = (value) => createHash("sha256").update(value).digest();
const expected = digest(`Bearer ${token}`);
const filename = resolve(process.env.HABITS_DATABASE ?? "./private/habits.sqlite");
mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
const adapter = openHabitAdapter(filename);
const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST" || request.url !== "/execute") { response.writeHead(404).end(); return; }
  if (!timingSafeEqual(expected, digest(request.headers.authorization ?? ""))) { response.writeHead(401).end(); return; }
  try {
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 600 * 1024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const result = adapter.execute(JSON.parse(Buffer.concat(chunks).toString("utf8")), request.headers["idempotency-key"]);
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(400).end(JSON.stringify({ status: "failure", code: "invalid_request", message: "A valid bounded execution request is required.", retryable: false }));
  }
});
server.listen(Number(process.env.PORT ?? 4319), "127.0.0.1", () => console.log(JSON.stringify({ event: "listening", address: "127.0.0.1", port: server.address().port })));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => { adapter.close(); process.exit(0); }));
