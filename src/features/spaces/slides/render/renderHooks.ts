import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { journalAssetDownloadPath, resolveJournalAssetUrl } from "../../journal/api/assets";

/** An element's laid-out size, kept current as it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const read = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Bumps each time the document finishes loading fonts, so fitted text measures again. */
export function useFontsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts?.addEventListener) return;
    const bump = () => setVersion((current) => current + 1);
    fonts.addEventListener("loadingdone", bump);
    void fonts.ready?.then(bump).catch(() => undefined);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);
  return version;
}

/** A deck image's verified data URL, or null while it loads or if it can't. */
export function useDeckAssetUrl(spaceId: string, deckId: string, assetId: string | null) {
  const [state, setState] = useState<{
    assetId: string | null;
    url: string | null;
    failed: boolean;
  }>({ assetId: null, url: null, failed: false });
  useEffect(() => {
    if (!assetId || !spaceId || !deckId) return;
    let active = true;
    resolveJournalAssetUrl(journalAssetDownloadPath("deck", spaceId, deckId, assetId))
      .then((url) => {
        if (active) setState({ assetId, url, failed: false });
      })
      .catch(() => {
        if (active) setState({ assetId, url: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, [spaceId, deckId, assetId]);
  return state.assetId === assetId ? state : { assetId, url: null, failed: false };
}

/** Resolves a deck image outside React, for the exports. */
export function deckAssetUrl(spaceId: string, deckId: string, assetId: string): Promise<string> {
  return resolveJournalAssetUrl(journalAssetDownloadPath("deck", spaceId, deckId, assetId));
}
