// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";

export interface XtermModules {
  Terminal: typeof Terminal;
  FitAddon: typeof FitAddon;
  WebglAddon: typeof WebglAddon;
}

// xterm and its CSS stay out of the first chunk: they load when a terminal first opens, and the
// module-level promise keeps that load for every later tab.
let xtermPromise: Promise<XtermModules> | null = null;

export function loadXterm(): Promise<XtermModules> {
  return (xtermPromise ??= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-webgl"),
    import("@xterm/xterm/css/xterm.css"),
  ]).then(([xterm, fit, webgl]) => ({
    Terminal: xterm.Terminal,
    FitAddon: fit.FitAddon,
    WebglAddon: webgl.WebglAddon,
  })));
}
