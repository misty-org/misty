import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceWebFetch, fetchRefused } from "../src/web-fetch/fetch-step.js";
import { fetchPublicPage, isPublicAddress } from "../src/web-fetch/public-fetch.js";

const code = (promise: Promise<unknown>) => promise.then(() => "fetched", (error: { code?: string }) => error.code);

describe("which addresses a fetch may reach", () => {
  it("refuses private and special addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "not-an-address"])
      expect(isPublicAddress(address), address).toBe(false);
    for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:1.1.1.1"])
      expect(isPublicAddress(address), address).toBe(true);
  });

  it("never connects to other schemes, credentials or local hosts", async () => {
    expect(await code(fetchPublicPage("file:///etc/passwd"))).toBe("invalid_url");
    expect(await code(fetchPublicPage("http://user:pw@example.com/"))).toBe("invalid_url");
    expect(await code(fetchPublicPage("not a url"))).toBe("invalid_url");
    expect(await code(fetchPublicPage("http://127.0.0.1:8081/health"))).toBe("private_address");
    expect(await code(fetchPublicPage("http://[::1]:8081/"))).toBe("private_address");
    expect(await code(fetchPublicPage("http://2130706433/"))).toBe("private_address");
    expect(await code(fetchPublicPage("http://localhost/"))).toBe("private_address");
  });
});

describe("fetching a page", () => {
  let server: Server;
  let base: string;
  // Stands in for a public site: only this test's own server counts as public.
  const allowLoopback = (address: string) => address === "127.0.0.1" || address === "::1";

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? "/";
      if (path === "/page") return response.writeHead(200, { "content-type": "text/html" }).end("<title>Hi</title><p>Hello</p>");
      if (path === "/hop") return response.writeHead(302, { location: "/page" }).end();
      if (path === "/loop") return response.writeHead(302, { location: "/loop" }).end();
      if (path === "/inside") return response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
      if (path === "/file") return response.writeHead(200, { "content-type": "application/zip" }).end("PK");
      if (path === "/huge") return response.writeHead(200, { "content-type": "text/plain" }).end(Buffer.alloc(3 * 1024 * 1024, "a"));
      if (path === "/gzip") return response.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }).end(gzipSync("unpacked"));
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("reads a page and follows redirects", async () => {
    expect(await fetchPublicPage(`${base}/page`, allowLoopback)).toMatchObject({ status: 200, body: "<title>Hi</title><p>Hello</p>", truncated: false });
    expect(await fetchPublicPage(`${base}/hop`, allowLoopback)).toMatchObject({ finalUrl: `${base}/page`, status: 200 });
    expect((await fetchPublicPage(`${base}/gzip`, allowLoopback)).body).toBe("unpacked");
  });

  it("checks every hop, not just the first", async () => {
    expect(await code(fetchPublicPage(`${base}/inside`, allowLoopback))).toBe("private_address");
    expect(await code(fetchPublicPage(`${base}/loop`, allowLoopback))).toBe("too_many_redirects");
  });

  it("refuses files and caps long bodies", async () => {
    expect(await code(fetchPublicPage(`${base}/file`, allowLoopback))).toBe("unsupported_content");
    const huge = await fetchPublicPage(`${base}/huge`, allowLoopback);
    expect(huge.truncated).toBe(true);
    expect(huge.body.length).toBe(2 * 1024 * 1024);
  });

  it("keeps a page from the checks out of the default path", async () => {
    expect(await code(fetchPublicPage(`${base}/page`))).toBe("private_address");
  });
});

describe("web.fetch as a tool", () => {
  it("answers failures in words the model can act on", async () => {
    expect(await deviceWebFetch({})).toMatchObject({ tool_error: { code: "invalid_arguments" } });
    expect(await deviceWebFetch({ url: "http://127.0.0.1/" })).toMatchObject({ tool_error: { code: "private_address", message: "that address is not a public website" } });
  });

  it("sends refused pages to a tab", () => {
    for (const status of [401, 403, 429, 503]) expect(fetchRefused(status, "")).toBe(true);
    expect(fetchRefused(200, "Just a moment...")).toBe(true);
    expect(fetchRefused(200, "Pricing")).toBe(false);
  });
});
