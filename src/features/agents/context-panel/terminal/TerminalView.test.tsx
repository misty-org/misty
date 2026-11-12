// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TerminalView drives xterm through a small public surface; the heavy parts (xterm, FitAddon,
 * ResizeObserver, the native calls, FontFaceSet) are stand-ins, so the test checks the wiring:
 * what font reaches xterm, when the shell hears the size, and that late work after unmount is
 * dropped.
 */

const apiMocks = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  write: vi.fn(async () => {}),
  resize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
}));
vi.mock("./terminalApi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  terminalApi: apiMocks,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: vi.fn(async () => () => {}) }),
}));

// Opening files goes through the files panel's store, which isn't under test here.
vi.mock("./openTarget", () => ({
  openTerminalPath: vi.fn(),
  openTerminalUrl: vi.fn(),
  resolveTerminalPath: () => null,
}));

const xtermMocks = vi.hoisted(() => {
  const instances: FakeTerminal[] = [];
  const fits: FakeFitAddon[] = [];

  class FakeTerminal {
    cols = 80;
    rows = 24;
    writes: string[] = [];
    openedWith: Element | null = null;
    disposed = false;
    element: HTMLElement | undefined = undefined;
    /** fontFamily values that really changed (xterm ignores setting the same value). */
    fontFamilySets: string[] = [];
    options: Record<string, unknown>;
    private family: string;

    constructor(options: { fontFamily: string; fontSize: number; theme: unknown }) {
      this.family = options.fontFamily;
      // The getter below needs this instance, not the options object it sits on.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      this.options = {
        theme: options.theme,
        fontSize: options.fontSize,
        get fontFamily() {
          return self.family;
        },
        set fontFamily(value: string) {
          if (self.family === value) return;
          self.family = value;
          self.fontFamilySets.push(value);
        },
      };
      instances.push(this);
    }

    loadAddon() {}
    open(el: Element) {
      this.openedWith = el;
    }
    write(data: string) {
      this.writes.push(data);
    }
    registerLinkProvider() {
      return { dispose() {} };
    }
    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return {
        dispose: () => {
          this.dataHandler = null;
        },
      };
    }
    dataHandler: ((data: string) => void) | null = null;
    emitData(data: string) {
      this.dataHandler?.(data);
    }
    getSelection() {
      return "";
    }
    dispose() {
      this.disposed = true;
    }
  }

  class FakeFitAddon {
    fit = vi.fn();
    dispose() {}
    constructor() {
      fits.push(this);
    }
  }

  class FakeWebglAddon {
    onContextLoss() {}
    dispose() {}
  }

  return { instances, fits, FakeTerminal, FakeFitAddon, FakeWebglAddon };
});

vi.mock("@/shared/lib/terminal/xtermLoader", () => ({
  loadXterm: async () => ({
    Terminal: xtermMocks.FakeTerminal,
    FitAddon: xtermMocks.FakeFitAddon,
    WebglAddon: xtermMocks.FakeWebglAddon,
  }),
}));

const resizeMocks = vi.hoisted(() => {
  const callbacks: ResizeObserverCallback[] = [];
  class FakeResizeObserver {
    constructor(cb: ResizeObserverCallback) {
      callbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  return { callbacks, FakeResizeObserver };
});

const fontMocks = vi.hoisted(() => {
  const pending: Array<{ font: string; resolve: () => void }> = [];
  const load = vi.fn(
    (font: string) =>
      new Promise<void>((resolve) => {
        pending.push({ font, resolve });
      }),
  );
  return { pending, load };
});

import { TerminalView } from "./TerminalView";
import {
  DEFAULT_MONO_STACK,
  TERMINAL_FONT_SIZE,
  computedMonoFontStack,
} from "@/shared/lib/terminal/appearance";
import { clearTerminalSessionState, receiveTerminalOutput } from "./sessions";
import { TERMINAL_GONE } from "./terminalApi";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "tab-1";
const CWD = "/tmp/project";

describe("terminal font", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefers the computed --font-mono stack, trimmed", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--font-mono" ? '  "Foo Bar", monospace  ' : "",
    } as unknown as CSSStyleDeclaration);
    expect(computedMonoFontStack()).toBe('"Foo Bar", monospace');
  });
});

describe("TerminalView wiring", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function flush() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<TerminalView id={ID} cwd={CWD} onCloseTab={() => {}} />);
    });
    // loadXterm() → setXterm → setup effect → terminalApi.open.
    await flush();
    await flush();
  }

  async function unmount() {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  }

  beforeEach(() => {
    xtermMocks.instances.length = 0;
    xtermMocks.fits.length = 0;
    resizeMocks.callbacks.length = 0;
    fontMocks.pending.length = 0;
    fontMocks.load.mockClear();
    apiMocks.open.mockClear();
    apiMocks.write.mockClear();
    apiMocks.resize.mockClear();
    clearTerminalSessionState(ID);
    vi.stubGlobal("ResizeObserver", resizeMocks.FakeResizeObserver);
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { load: fontMocks.load, add: () => {}, delete: () => {}, has: () => false },
    });
  });

  afterEach(async () => {
    if (root) await unmount();
    vi.unstubAllGlobals();
  });

  it("opens with the code font and waits for it with a legal font shorthand", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    expect(term.options.fontFamily).toBe(DEFAULT_MONO_STACK);
    expect(term.options.fontSize).toBe(TERMINAL_FONT_SIZE);
    expect(term.openedWith).not.toBeNull();
    expect(xtermMocks.fits[0].fit).toHaveBeenCalled();
    expect(apiMocks.open).toHaveBeenCalledWith(ID, CWD, 80, 24);
    expect(fontMocks.load).toHaveBeenCalledWith(expect.stringMatching(/^12.5px .*monospace$/));
  });

  it("replays output the shell printed while no view was mounted", async () => {
    receiveTerminalOutput([{ id: ID, data: "hello\r\n" }]);
    await mount();
    expect(xtermMocks.instances[0].writes).toEqual(["hello\r\n"]);
    receiveTerminalOutput([{ id: ID, data: "more" }]);
    expect(xtermMocks.instances[0].writes).toEqual(["hello\r\n", "more"]);
  });

  it("measures the same family again once its webfont finishes loading", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const family = term.options.fontFamily as string;
    expect(term.fontFamilySets).toEqual([]);

    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
    });
    await flush();

    // A probe value makes xterm see a real change, then the real family comes back.
    expect(term.fontFamilySets).toEqual([`${family}, monospace`, family]);
  });

  it("debounces resize churn into one shell resize", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const onChange = resizeMocks.callbacks[0];
    expect(onChange).toBeTypeOf("function");

    act(() => {
      onChange([], {} as ResizeObserver);
      onChange([], {} as ResizeObserver);
    });
    expect(xtermMocks.fits[0].fit).toHaveBeenCalled();
    expect(apiMocks.resize).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(apiMocks.resize).toHaveBeenCalledExactlyOnceWith(ID, term.cols, term.rows);
  });

  it("drops a late font load after unmount", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    const fit = xtermMocks.fits[0];
    const setsBefore = [...term.fontFamilySets];
    const fitCalls = fit.fit.mock.calls.length;

    await unmount();
    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
    });
    await flush();

    expect(term.disposed).toBe(true);
    expect(term.fontFamilySets).toEqual(setsBefore);
    expect(fit.fit.mock.calls.length).toBe(fitCalls);
  });

  it("sends the refitted size once a slow shell start completes", async () => {
    let resolveOpen!: () => void;
    apiMocks.open.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    await mount();
    const term = xtermMocks.instances[0];
    term.cols = 96;
    term.rows = 18;
    await act(async () => {
      fontMocks.pending.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(apiMocks.resize).not.toHaveBeenCalled();
    await act(async () => {
      resolveOpen();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(apiMocks.resize).toHaveBeenLastCalledWith(ID, 96, 18);
  });

  it("drops a pending resize when the view unmounts first", async () => {
    await mount();
    act(() => {
      resizeMocks.callbacks[0]([], {} as ResizeObserver);
    });
    await unmount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 170));
    });
    expect(apiMocks.resize).not.toHaveBeenCalled();
  });

  it("leaves the shell running when the view unmounts", async () => {
    await mount();
    await unmount();
    expect(apiMocks.close).not.toHaveBeenCalled();
  });

  it("writes typed input through the ordered queue", async () => {
    await mount();
    const term = xtermMocks.instances[0];
    await act(async () => {
      term.emitData("ab");
      term.emitData("c");
    });
    await flush();
    expect(apiMocks.write.mock.calls).toEqual([
      [ID, "ab"],
      [ID, "c"],
    ]);
  });

  it("starts the shell again and resends input after it ended", async () => {
    await mount();
    apiMocks.write.mockRejectedValueOnce(new Error(TERMINAL_GONE));
    const term = xtermMocks.instances[0];
    await act(async () => {
      term.emitData("x");
    });
    await flush();
    await flush();
    expect(apiMocks.open).toHaveBeenCalledTimes(2);
    expect(apiMocks.write.mock.calls).toEqual([
      [ID, "x"],
      [ID, "x"],
    ]);
  });
});
