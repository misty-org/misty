import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSetupKey,
  parseServerAddress,
  parseSetupDeepLink,
  parseSetupLink,
  serverHost,
} from "./serverAddress";

const key = "misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

describe("server addresses", () => {
  it("takes an address with or without its scheme and API path", () => {
    for (const input of [
      "cloud.misty.example",
      "https://cloud.misty.example",
      "https://cloud.misty.example/",
      " https://cloud.misty.example/v1 ",
      "https://cloud.misty.example/setup",
    ]) {
      expect(parseServerAddress(input)).toEqual({
        origin: "https://cloud.misty.example",
        apiBase: "https://cloud.misty.example/v1",
      });
    }
    expect(parseServerAddress("https://misty.example.org:8443/api/v2")).toEqual({
      origin: "https://misty.example.org:8443",
      apiBase: "https://misty.example.org:8443/api/v2",
    });
  });

  describe("in a release build", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("takes https domains", () => {
      vi.stubEnv("DEV", false);
      expect(parseServerAddress("misty.example.com")).toEqual({
        origin: "https://misty.example.com",
        apiBase: "https://misty.example.com/v1",
      });
      expect(parseServerAddress("https://misty.example.org:8443")).not.toHaveProperty("error");
    });

    it("refuses plain http, IP addresses and this computer", () => {
      vi.stubEnv("DEV", false);
      for (const input of [
        "http://misty.example.org",
        "http://127.0.0.1:8081",
        "http://localhost:8081",
        "http://[::1]:8081",
        "localhost:8081",
        "https://localhost",
        "https://localhost.",
        "https://app.localhost",
        "https://127.0.0.1:8443",
        "https://192.168.1.20",
        "https://[::1]",
        "https://misty",
      ]) {
        expect(parseServerAddress(input)).toHaveProperty("error");
      }
    });

    it("refuses setup links to this computer", () => {
      vi.stubEnv("DEV", false);
      expect(parseSetupLink(`http://127.0.0.1:8081/setup#key=${key}`)).toBeNull();
      expect(parseSetupLink(`https://mistysys.com/setup#server=localhost&key=${key}`)).toBeNull();
      expect(parseSetupDeepLink(`misty://setup?server=localhost:8081&key=${key}`)).toBeNull();
      expect(parseSetupDeepLink(`misty://setup?server=api.mistysys.com&key=${key}`)).not.toBeNull();
    });
  });

  it("allows plain http only on this computer in development", () => {
    expect(parseServerAddress("http://127.0.0.1:8081")).toEqual({
      origin: "http://127.0.0.1:8081",
      apiBase: "http://127.0.0.1:8081/v1",
    });
    expect(parseServerAddress("http://misty.example.org")).toHaveProperty("error");
  });

  it("refuses what isn't a server address", () => {
    for (const input of [
      "",
      "ftp://misty.example",
      "https://user:pass@misty.example",
      "https://",
    ]) {
      expect(parseServerAddress(input)).toHaveProperty("error");
    }
  });

  it("names the host to show", () => {
    expect(serverHost("https://cloud.misty.example/v1")).toBe("cloud.misty.example");
  });
});

describe("setup links", () => {
  it("reads the server and key from the welcome email's link", () => {
    expect(parseSetupLink(`https://cloud.misty.example/setup#key=${key}`)).toEqual({
      origin: "https://cloud.misty.example",
      apiBase: "https://cloud.misty.example/v1",
      setupKey: key,
    });
  });

  it("reads the server the website's link names in its fragment", () => {
    expect(parseSetupLink(`https://mistysys.com/setup#server=api.mistysys.com&key=${key}`)).toEqual(
      { origin: "https://api.mistysys.com", apiBase: "https://api.mistysys.com/v1", setupKey: key },
    );
    expect(
      parseSetupLink(`https://mistysys.com/setup#server=http://api.mistysys.com&key=${key}`),
    ).toBeNull();
    expect(
      parseSetupLink(`https://mistysys.com/setup#server=http://127.0.0.1:8081&key=${key}`),
    ).toBeNull();
  });

  it("is null for an address alone or a malformed key", () => {
    expect(parseSetupLink("https://cloud.misty.example/setup")).toBeNull();
    expect(parseSetupLink("https://cloud.misty.example/setup#key=misty_setup_short")).toBeNull();
    expect(parseSetupLink(`notaurl#key=${key}`.replace("notaurl", "ftp://x"))).toBeNull();
  });

  it("knows a setup key by its shape", () => {
    expect(isSetupKey(key)).toBe(true);
    expect(isSetupKey(` ${key.toLowerCase()} `)).toBe(true);
    expect(isSetupKey("misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ23456")).toBe(false);
    expect(isSetupKey("misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234561")).toBe(false);
  });
});

describe("misty://setup links", () => {
  it("fill in the server and key", () => {
    const expected = {
      origin: "https://api.mistysys.com",
      apiBase: "https://api.mistysys.com/v1",
      setupKey: key,
    };
    expect(parseSetupDeepLink(`misty://setup?server=api.mistysys.com&key=${key}`)).toEqual(
      expected,
    );
    expect(
      parseSetupDeepLink(
        `misty://setup?server=${encodeURIComponent("https://api.mistysys.com")}&key=${key}`,
      ),
    ).toEqual(expected);
    expect(parseSetupDeepLink(`misty://setup/?server=misty.example.org:8443&key=${key}`)).toEqual({
      origin: "https://misty.example.org:8443",
      apiBase: "https://misty.example.org:8443/v1",
      setupKey: key,
    });
  });

  it("only name an https server", () => {
    for (const server of [
      "http://api.mistysys.com",
      "http://127.0.0.1:8081",
      "ftp://api.mistysys.com",
      "javascript:alert(1)",
      "https://user:pass@api.mistysys.com",
      "",
    ])
      expect(
        parseSetupDeepLink(`misty://setup?server=${encodeURIComponent(server)}&key=${key}`),
      ).toBeNull();
  });

  it("need a setup key and the setup route", () => {
    expect(parseSetupDeepLink("misty://setup?server=api.mistysys.com&key=hunter2")).toBeNull();
    expect(parseSetupDeepLink("misty://setup?server=api.mistysys.com")).toBeNull();
    expect(parseSetupDeepLink(`misty://open/setup?server=api.mistysys.com&key=${key}`)).toBeNull();
    expect(parseSetupDeepLink(`https://setup?server=api.mistysys.com&key=${key}`)).toBeNull();
    expect(parseSetupDeepLink("not a link")).toBeNull();
  });
});
