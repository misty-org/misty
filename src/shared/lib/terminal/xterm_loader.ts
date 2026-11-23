// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { ImageAddon } from "@xterm/addon-image";
import type { WebglAddon } from "@xterm/addon-webgl";

export interface XtermModules {
  Terminal: typeof Terminal;
  FitAddon: typeof FitAddon;
  WebglAddon: typeof WebglAddon;
  ImageAddon: typeof ImageAddon | null;
}

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
      xtermPromise = null;
      throw reason;
    }));
}
