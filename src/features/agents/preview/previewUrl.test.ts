import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleDeviceSettings } from "@/tests/fakeDeviceSettings";
import {
  defaultPreviewUrl,
  parsePreviewUrl,
  rememberedPreviewUrl,
  rememberPreviewUrl,
  shownPreviewUrl,
} from "./previewUrl";

const db = await vi.hoisted(async () =>
  (await import("@/tests/fakeDeviceSettings")).fakeDeviceSettings(),
);
vi.mock("@/native/invoke", () => ({ invoke: db.invoke }));

describe("parsePreviewUrl", () => {
  it("accepts addresses on this computer, with any port and path", () => {
    expect(parsePreviewUrl("http://localhost:3000")).toEqual({
      ok: true,
      url: "http://localhost:3000/",
    });
    expect(parsePreviewUrl(" http://127.0.0.1:4173/app/page?tab=1#top ")).toEqual({
      ok: true,
      url: "http://127.0.0.1:4173/app/page?tab=1#top",
    });
    expect(parsePreviewUrl("http://[::1]:5173/")).toEqual({ ok: true, url: "http://[::1]:5173/" });
    expect(parsePreviewUrl("http://shop.localhost:8080/cart").ok).toBe(true);
    expect(parsePreviewUrl("http://LOCALHOST/").ok).toBe(true);
  });

  it("adds http:// to a bare address", () => {
    expect(parsePreviewUrl("localhost:5173")).toEqual({ ok: true, url: "http://localhost:5173/" });
    expect(parsePreviewUrl("127.0.0.1:8000/docs")).toEqual({
      ok: true,
      url: "http://127.0.0.1:8000/docs",
    });
  });

  it("refuses everything else", () => {
    for (const address of [
      "",
      "https://localhost:3000",
      "http://example.com",
      "example.com",
      "http://localhost.example.com",
      "http://notlocalhost:3000",
      "http://127.0.0.2:3000",
      "http://192.168.1.20:3000",
      "http://0.0.0.0:3000",
      "http://user:secret@localhost:3000",
      "file:///etc/hosts",
      "javascript://localhost/%0aalert(1)",
      "http://",
    ]) {
      const parsed = parsePreviewUrl(address);
      expect(parsed.ok, address).toBe(false);
      if (!parsed.ok) expect(parsed.message).not.toBe("");
    }
  });
});

describe("shownPreviewUrl", () => {
  it("drops only a bare origin's slash", () => {
    expect(shownPreviewUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(shownPreviewUrl("http://localhost:3000/docs/")).toBe("http://localhost:3000/docs/");
    expect(shownPreviewUrl("http://localhost:3000/?a=1")).toBe("http://localhost:3000/?a=1");
  });
});

describe("the remembered address", () => {
  beforeEach(() => localStorage.clear());

  it("is kept per Space in misty.db and starts at the default", async () => {
    expect(rememberedPreviewUrl("space-a")).toBe(defaultPreviewUrl);
    rememberPreviewUrl("space-a", "http://127.0.0.1:4173/");
    expect(rememberedPreviewUrl("space-a")).toBe("http://127.0.0.1:4173/");
    expect(rememberedPreviewUrl("space-b")).toBe(defaultPreviewUrl);
    await settleDeviceSettings();
    expect(db.read("preview-urls")).toMatchObject({
      "space-a": { url: "http://127.0.0.1:4173/", at: expect.any(Number) },
    });
  });

  it("moves an address kept in webview storage into misty.db", async () => {
    localStorage.setItem("misty.preview.url:space-c", "http://localhost:5173/");
    expect(rememberedPreviewUrl("space-c")).toBe("http://localhost:5173/");
    expect(localStorage.getItem("misty.preview.url:space-c")).toBeNull();
    await settleDeviceSettings();
    expect(db.read("preview-urls")).toMatchObject({
      "space-c": { url: "http://localhost:5173/" },
    });
  });

  it("ignores a stored address that isn't local", () => {
    localStorage.setItem("misty.preview.url:space-d", "https://example.com/");
    expect(rememberedPreviewUrl("space-d")).toBe(defaultPreviewUrl);
  });
});
