import type { MistyAppSDK } from "@misty/sdk";

const origin = "https://apps.mistysys.com/official-app-assets/journal/";
const prefix = "drawing-font-v1:";
const inlinePrefix = "data:font/woff2;base64,";
const maxBytes = 128 * 1024; // Fits the SDK's bounded native network response.
const cacheBudget = 768 * 1024;
type CachedFont = { data: string; used: number };
type Face = { urls: (string | URL)[]; fontFace: FontFace; getUnicodeRangeRegex(): RegExp };

/** Optional immutable fonts use the public SDK, never a browser/CDN fetch. */
export function createSdkDrawingFonts(misty: MistyAppSDK, signal: AbortSignal) {
  const pending = new WeakMap<
    FontFace,
    { family: string; uri: string; descriptors: FontFaceDescriptors }
  >();
  const owned = new Set<FontFace>();
  const loads = new Map<string, Promise<ArrayBuffer>>();
  let queue: Promise<unknown> = Promise.resolve();
  let notified = false;
  const assert = () => {
    if (signal.aborted) throw new DOMException("Journal closed while loading fonts.", "AbortError");
  };
  signal.addEventListener(
    "abort",
    () => {
      for (const face of owned) document.fonts.delete(face);
      owned.clear();
      loads.clear();
    },
    { once: true },
  );
  const decode = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
  const encode = (value: ArrayBuffer) => {
    const bytes = new Uint8Array(value);
    let text = "";
    for (let i = 0; i < bytes.length; i += 8192)
      text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  };
  const verify = async (bytes: ArrayBuffer, hash: string) => {
    if (
      bytes.byteLength < 4 ||
      bytes.byteLength > maxBytes ||
      new TextDecoder().decode(bytes.slice(0, 4)) !== "wOF2"
    )
      throw new Error("Invalid drawing font download.");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    if (Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") !== hash)
      throw new Error("Drawing font download failed its integrity check.");
    assert();
    return bytes;
  };
  const cache = async (key: string, bytes: ArrayBuffer) => {
    // A small LRU cache leaves room for other app preferences. Quota failures
    // must not prevent a verified font from being used in the current drawing.
    try {
      assert();
      const data = encode(bytes);
      const entries = await Promise.all(
        (await misty.storage.local.keys())
          .filter((k) => k.startsWith(prefix) && k !== key)
          .map(async (k) => ({ key: k, value: await misty.storage.local.get<CachedFont>(k) })),
      );
      assert();
      entries.sort((a, b) => (a.value?.used ?? 0) - (b.value?.used ?? 0));
      let total = data.length + entries.reduce((sum, e) => sum + (e.value?.data?.length ?? 0), 0);
      for (const entry of entries) {
        if (total <= cacheBudget) break;
        assert();
        await misty.storage.local.delete(entry.key);
        total -= entry.value?.data?.length ?? 0;
      }
      assert();
      await misty.storage.local.set(key, { data, used: Date.now() });
    } catch {
      /* Caching is best effort; verification is mandatory. */
    }
  };
  const read = async (uri: string): Promise<ArrayBuffer> => {
    assert();
    if (uri.startsWith(inlinePrefix)) return decode(uri.slice(inlinePrefix.length));
    if (!uri.startsWith(origin) || !/^[a-f0-9]{64}\.woff2$/.test(uri.slice(origin.length)))
      throw new Error("This drawing font is not a declared Misty asset.");
    const existing = loads.get(uri);
    if (existing) return existing;
    const hash = uri.slice(origin.length, -6),
      key = prefix + hash;
    // Serialize native requests so the first origin approval cannot compete
    // with requests for other font subsets.
    const request = queue
      .catch(() => undefined)
      .then(async () => {
        assert();
        try {
          const value = await misty.storage.local.get<CachedFont>(key);
          if (
            value &&
            typeof value.data === "string" &&
            value.data.length <= Math.ceil(maxBytes / 3) * 4
          ) {
            const bytes = await verify(decode(value.data), hash);
            await cache(key, bytes);
            assert();
            return bytes;
          }
        } catch {
          assert();
        } // Corrupt/evicted cache entries are downloaded again.
        assert();
        const response = await misty.network.fetch(uri, { headers: { Accept: "font/woff2" } });
        assert();
        if (response.status !== 200)
          throw new Error("Drawing font could not download. Check your connection and try again.");
        const bytes = await verify(await response.arrayBuffer(), hash);
        await cache(key, bytes);
        assert();
        return bytes;
      });
    queue = request.catch(() => undefined);
    loads.set(uri, request);
    void request.catch(() => {
      loads.delete(uri);
    });
    return request;
  };
  return {
    read,
    observeScene(
      scene: {
        onUpdate(callback: () => void): () => void;
        getNonDeletedElements(): { type: string; text?: string; fontFamily?: number }[];
      },
      load: () => Promise<unknown>,
    ) {
      let previous = "",
        scheduled = false;
      const remove = scene.onUpdate(() => {
        if (scheduled || signal.aborted) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (signal.aborted) return;
          const signature = JSON.stringify(
            scene
              .getNonDeletedElements()
              .filter((e) => e.type === "text")
              .map((e) => [e.fontFamily, e.text]),
          );
          if (signature === previous) return;
          previous = signature;
          void load().catch(() => undefined);
        });
      });
      signal.addEventListener(
        "abort",
        () => {
          try {
            remove();
          } catch {
            /* Excalidraw may have destroyed the scene first. */
          }
        },
        { once: true },
      );
    },
    async content(uri: string) {
      if (uri.startsWith(inlinePrefix)) {
        assert();
        return uri;
      }
      return inlinePrefix + encode(await read(uri));
    },
    createFace(family: string, uri: string, sources: string, descriptors: FontFaceDescriptors) {
      assert();
      const optional = uri.startsWith(origin);
      // Unverified remote bytes must never enter the browser font loader.
      const face = new FontFace(
        family,
        optional ? 'local("MistyPendingDrawingFont")' : sources,
        descriptors,
      );
      if (optional) pending.set(face, { family, uri, descriptors });
      owned.add(face);
      return face;
    },
    isPending(face: FontFace) {
      return pending.has(face);
    },
    async prepare(faces: Face[], characters: string) {
      const loaded: FontFace[] = [];
      for (const wrapper of faces) {
        const info = pending.get(wrapper.fontFace);
        if (!info || !wrapper.getUnicodeRangeRegex().test(characters)) continue;
        try {
          const bytes = await read(info.uri);
          assert();
          const previous = wrapper.fontFace;
          // Another concurrent scene load may already have installed this face.
          if (!pending.has(previous)) continue;
          const face = new FontFace(info.family, bytes, info.descriptors);
          await face.load();
          assert();
          if (!pending.has(wrapper.fontFace)) continue;
          document.fonts.delete(previous);
          owned.delete(previous);
          pending.delete(previous);
          owned.add(face);
          wrapper.fontFace = face;
          loaded.push(face);
        } catch {
          assert();
          if (!notified) {
            notified = true;
            void misty.ui
              .toast("Some drawing fonts could not download. Reopen the drawing to retry.", "error")
              .catch(() => undefined);
          }
          // Keep system fallback text visible; exports still await read() and
          // reject if the exact font cannot be verified.
          break;
        }
      }
      return loaded;
    },
  };
}
