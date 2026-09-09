import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import type { MistyAppSDK } from "@misty/sdk";
import { createSdkDrawingFonts } from "./sdkDrawingFonts";
const origin = "https://apps.mistysys.com/official-app-assets/journal/";
const font = new TextEncoder().encode("wOF2verified-font-fixture");
const hash = createHash("sha256").update(font).digest("hex");
const uri = `${origin}${hash}.woff2`;
class TestFace {
  family: string;
  unicodeRange: string;
  source: unknown;
  constructor(family: string, source: unknown, descriptors: FontFaceDescriptors = {}) {
    this.family = family;
    this.source = source;
    this.unicodeRange = descriptors.unicodeRange ?? "U+0-10FFFF";
  }
  async load() {
    return this;
  }
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("FontFace", TestFace);
  vi.stubGlobal("document", { fonts: new Set() });
});
afterEach(() => vi.unstubAllGlobals());
function fixture(shared = new Map<string, unknown>()) {
  const controller = new AbortController();
  const network = vi.fn(async (_uri: string) => new Response(font));
  const set = vi.fn(async (key: string, value: unknown) => {
    shared.set(key, value);
  });
  const sdk = {
    network: { fetch: network },
    storage: {
      local: {
        get: async (key: string) => shared.get(key) ?? null,
        set,
        keys: async () => [...shared.keys()],
        delete: async (key: string) => {
          shared.delete(key);
        },
      },
    },
    ui: { toast: vi.fn(async () => undefined) },
  } as unknown as MistyAppSDK;
  return {
    fonts: createSdkDrawingFonts(sdk, controller.signal),
    controller,
    shared,
    network,
    set,
    sdk,
  };
}
it("keeps bundled fonts local and downloads no optional fonts at construction", async () => {
  const f = fixture(),
    data = `data:font/woff2;base64,${Buffer.from(font).toString("base64")}`;
  expect(await f.fonts.content(data)).toBe(data);
  const face = f.fonts.createFace("Xiaolai", uri, `url(${uri})`, { unicodeRange: "U+4E2D" });
  expect((face as unknown as TestFace).source).not.toContain("https:");
  expect(f.network).not.toHaveBeenCalled();
});
it("deduplicates requests and reuses a verified persistent cache in another mount", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.fonts.read(uri), f.fonts.read(uri)]);
  expect(Array.from(new Uint8Array(a))).toEqual(Array.from(font));
  expect(b).toBe(a);
  expect(f.network).toHaveBeenCalledTimes(1);
  const next = fixture(f.shared);
  await next.fonts.read(uri);
  expect(next.network).not.toHaveBeenCalled();
  expect(f.network.mock.calls[0][0]).toBe(uri);
});
it("rejects corrupt downloads without caching them, and allows retry", async () => {
  const f = fixture();
  f.network.mockResolvedValueOnce(new Response("wOF2corrupt"));
  await expect(f.fonts.content(uri)).rejects.toThrow(/integrity/);
  expect(f.set).not.toHaveBeenCalled();
  expect(await f.fonts.content(uri)).toMatch(/^data:font\/woff2;base64,/);
  expect(f.network).toHaveBeenCalledTimes(2);
});
it("redownloads corrupt cache entries rather than passing them to FontFace", async () => {
  const f = fixture(new Map([[`drawing-font-v1:${hash}`, { data: btoa("wOF2corrupt"), used: 0 }]]));
  expect(Array.from(new Uint8Array(await f.fonts.read(uri)))).toEqual(Array.from(font));
  expect(f.network).toHaveBeenCalledTimes(1);
});
it("does not commit an in-flight download after the app closes", async () => {
  const f = fixture();
  let finish!: (response: Response) => void;
  f.network.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = f.fonts.read(uri);
  await vi.waitFor(() => expect(finish).toBeDefined());
  f.controller.abort();
  finish(new Response(font));
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(f.set).not.toHaveBeenCalled();
});
it("loads only matching unicode subsets and removes its faces when closed", async () => {
  const f = fixture();
  const wrap = (characters: string) => ({
    fontFace: f.fonts.createFace("Xiaolai", uri, `url(${uri})`, { unicodeRange: "U+4E2D" }),
    urls: [uri],
    getUnicodeRangeRegex: () => new RegExp(characters),
  });
  const a = wrap("中"),
    b = wrap("日");
  await f.fonts.prepare([a, b], "hello");
  expect(f.network).not.toHaveBeenCalled();
  await f.fonts.prepare([a, b], "中");
  expect(f.network).toHaveBeenCalledTimes(1);
  expect(f.fonts.isPending(a.fontFace)).toBe(false);
  expect(f.fonts.isPending(b.fontFace)).toBe(true);
  document.fonts.add(a.fontFace);
  f.controller.abort();
  expect(document.fonts.has(a.fontFace)).toBe(false);
});
it("keeps fallback rendering on failure but fails exports that need the missing font", async () => {
  const f = fixture();
  f.network.mockResolvedValue(new Response("", { status: 503 }));
  const face = {
    fontFace: f.fonts.createFace("Xiaolai", uri, `url(${uri})`, {}),
    urls: [uri],
    getUnicodeRangeRegex: () => /中/,
  };
  await f.fonts.prepare([face], "中");
  expect(f.fonts.isPending(face.fontFace)).toBe(true);
  expect(f.sdk.ui.toast).toHaveBeenCalledTimes(1);
  await expect(f.fonts.content(uri)).rejects.toThrow(/could not download/);
});
it("rejects foreign origins and non-content-addressed font URLs", async () => {
  const f = fixture();
  for (const value of ["https://evil.test/font.woff2", origin + "font.woff2", uri + "?redirect=1"])
    await expect(f.fonts.read(value)).rejects.toThrow(/not a declared/);
  expect(f.network).not.toHaveBeenCalled();
});
