// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { ImageAddon } from "@xterm/addon-image";
import type { WebglAddon } from "@xterm/addon-webgl";

export interface XtermModules {
  Terminal: typeof Terminal;
  FitAddon: typeof FitAddon;
  WebglAddon: typeof WebglAddon;
  /**
   * Pictures in the terminal: Sixel and iTerm2's inline images (imgcat, chafa, fastfetch). Null
   * when it couldn't load: the terminal works without it, so it never holds the terminal back.
   */
  ImageAddon: typeof ImageAddon | null;
}

// xterm and its CSS stay out of the first chunk: they load when a terminal first opens, and the
// module-level promise keeps that load for every later tab.
let xtermPromise: Promise<XtermModules> | null = null;

export function loadXterm(): Promise<XtermModules> {
  return (xtermPromise ??= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-webgl"),
    import("@xterm/addon-image").catch(() => null),
    import("@xterm/xterm/css/xterm.css"),
  ])
    .then(([xterm, fit, webgl, image]) => ({
      Terminal: xterm.Terminal,
      FitAddon: fit.FitAddon,
      WebglAddon: webgl.WebglAddon,
      ImageAddon: image?.ImageAddon ?? null,
    }))
    .catch((reason: unknown) => {
      // A failed load is tried again by the next terminal, rather than kept for good.
      xtermPromise = null;
      throw reason;
    }));
}
