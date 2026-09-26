import { describe, expect, it } from "vitest";
import {
  isIpv4Address,
  isIpv6Address,
  isLocalHostOrDomain,
  normalizeBrowserAddress,
  parseAuthority,
  resolveDirectAddress,
} from "./browserAddress";

describe("browser address parsing and normalization", () => {
  describe("isIpv4Address", () => {
    it("recognizes valid IPv4 addresses", () => {
      expect(isIpv4Address("127.0.0.1")).toBe(true);
      expect(isIpv4Address("0.0.0.0")).toBe(true);
      expect(isIpv4Address("192.168.1.1")).toBe(true);
      expect(isIpv4Address("10.0.0.1")).toBe(true);
      expect(isIpv4Address("255.255.255.255")).toBe(true);
    });

    it("rejects invalid IPv4 addresses", () => {
      expect(isIpv4Address("256.0.0.1")).toBe(false);
      expect(isIpv4Address("1.2.3")).toBe(false);
      expect(isIpv4Address("1.2.3.4.5")).toBe(false);
      expect(isIpv4Address("example.com")).toBe(false);
      expect(isIpv4Address("127.0.0.a")).toBe(false);
    });
  });

  describe("isIpv6Address", () => {
    it("recognizes IPv6 addresses", () => {
      expect(isIpv6Address("[::1]")).toBe(true);
      expect(isIpv6Address("::1")).toBe(true);
      expect(isIpv6Address("[2001:db8::1]")).toBe(true);
      expect(isIpv6Address("fe80::1")).toBe(true);
    });

    it("rejects non-IPv6 strings", () => {
      expect(isIpv6Address("localhost")).toBe(false);
      expect(isIpv6Address("127.0.0.1")).toBe(false);
    });
  });

  describe("isLocalHostOrDomain", () => {
    it("recognizes localhost and local domain names", () => {
      expect(isLocalHostOrDomain("localhost")).toBe(true);
      expect(isLocalHostOrDomain("LOCALHOST")).toBe(true);
      expect(isLocalHostOrDomain("api.localhost")).toBe(true);
      expect(isLocalHostOrDomain("macbook.local")).toBe(true);
      expect(isLocalHostOrDomain("host.docker.internal")).toBe(true);
      expect(isLocalHostOrDomain("router.lan")).toBe(true);
    });

    it("rejects public domain names", () => {
      expect(isLocalHostOrDomain("example.com")).toBe(false);
      expect(isLocalHostOrDomain("google.com")).toBe(false);
    });
  });

  describe("parseAuthority", () => {
    it("extracts host and valid ports", () => {
      expect(parseAuthority("localhost:3000")).toEqual({ host: "localhost", port: 3000 });
      expect(parseAuthority("localhost")).toEqual({ host: "localhost" });
      expect(parseAuthority("[::1]:8080")).toEqual({
        host: "[::1]",
        port: 8080,
        isIpv6Bracketed: true,
      });
      expect(parseAuthority("::1")).toEqual({
        host: "[::1]",
        isIpv6Bracketed: true,
      });
    });

    it("rejects non-numeric or out-of-range ports", () => {
      expect(parseAuthority("tag:urgent")).toBeNull();
      expect(parseAuthority("site:github.com")).toBeNull();
      expect(parseAuthority("port:999999")).toBeNull();
      expect(parseAuthority("port:0")).toBeNull();
    });
  });

  describe("resolveDirectAddress", () => {
    it("resolves localhost and local ports to HTTP", () => {
      expect(resolveDirectAddress("localhost:3000")).toBe("http://localhost:3000");
      expect(resolveDirectAddress("localhost:3000/api?v=1#sec")).toBe(
        "http://localhost:3000/api?v=1#sec",
      );
      expect(resolveDirectAddress("localhost")).toBe("http://localhost");
      expect(resolveDirectAddress("localhost/test")).toBe("http://localhost/test");
      expect(resolveDirectAddress("sub.localhost:8080")).toBe("http://sub.localhost:8080");
      expect(resolveDirectAddress("devbox:3000")).toBe("http://devbox:3000");
    });

    it("resolves IP addresses to HTTP", () => {
      expect(resolveDirectAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
      expect(resolveDirectAddress("127.0.0.1")).toBe("http://127.0.0.1");
      expect(resolveDirectAddress("0.0.0.0:4000")).toBe("http://0.0.0.0:4000");
      expect(resolveDirectAddress("192.168.1.1")).toBe("http://192.168.1.1");
      expect(resolveDirectAddress("10.0.0.1:5173")).toBe("http://10.0.0.1:5173");
      expect(resolveDirectAddress("[::1]:3000")).toBe("http://[::1]:3000");
      expect(resolveDirectAddress("::1")).toBe("http://[::1]");
    });

    it("resolves local network TLDs to HTTP", () => {
      expect(resolveDirectAddress("macbook.local:3000")).toBe("http://macbook.local:3000");
      expect(resolveDirectAddress("macbook.local")).toBe("http://macbook.local");
      expect(resolveDirectAddress("host.docker.internal:8080")).toBe(
        "http://host.docker.internal:8080",
      );
    });

    it("resolves public domains to HTTPS", () => {
      expect(resolveDirectAddress("example.com")).toBe("https://example.com");
      expect(resolveDirectAddress("example.com/docs")).toBe("https://example.com/docs");
      expect(resolveDirectAddress("example.com:8443")).toBe("https://example.com:8443");
    });

    it("preserves explicit web URLs and blank pages", () => {
      expect(resolveDirectAddress("http://localhost:3000")).toBe("http://localhost:3000");
      expect(resolveDirectAddress("https://localhost:3000")).toBe("https://localhost:3000");
      expect(resolveDirectAddress("about:blank")).toBe("about:blank");
      expect(resolveDirectAddress("   ")).toBe("about:blank");
    });

    it("returns null for free-text search queries", () => {
      expect(resolveDirectAddress("human agent workspace")).toBeNull();
      expect(resolveDirectAddress("hello world")).toBeNull();
      expect(resolveDirectAddress("hello")).toBeNull();
      expect(resolveDirectAddress("site:github.com")).toBeNull();
      expect(resolveDirectAddress("tag:urgent")).toBeNull();
    });
  });

  describe("normalizeBrowserAddress & normalizeBrowserAddress", () => {
    it("delegates both to the same resolution and falls back to search", () => {
      expect(normalizeBrowserAddress("localhost:3000")).toBe("http://localhost:3000");
      expect(normalizeBrowserAddress("localhost:3000")).toBe("http://localhost:3000");

      expect(normalizeBrowserAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
      expect(normalizeBrowserAddress("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");

      expect(normalizeBrowserAddress("human agent workspace")).toBe(
        "https://www.google.com/search?q=human%20agent%20workspace",
      );
      expect(normalizeBrowserAddress("human agent workspace")).toBe(
        "https://www.google.com/search?q=human%20agent%20workspace",
      );
    });
  });
});
