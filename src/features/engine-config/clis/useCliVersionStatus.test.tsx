// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  update: vi.fn(),
  signedIn: vi.fn(),
  updatePlan: vi.fn(),
}));
vi.mock("./api", () => ({
  cliApi: mocks,
  listenCliUpdateProgress: () => Promise.resolve(() => {}),
}));

import type { CliVersionStatus } from "./api";
import { useCliUpdateFlow, type CliUpdateFlow } from "./useCliUpdateFlow";
import {
  resetCliStatusForTests,
  useCliVersionStatus,
  type CliVersionStatusView,
} from "./useCliVersionStatus";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function versionStatus(engine: string, over: Partial<CliVersionStatus> = {}): CliVersionStatus {
  return {
    engine,
    installed: true,
    localVersion: "2.1.228 (Claude Code)",
    latestVersion: "2.1.267",
    updateAvailable: true,
    updateKind: "native",
    installedByMisty: false,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe({
  engine,
  capture,
}: {
  engine: string;
  capture: (v: CliVersionStatusView) => void;
}) {
  const value = useCliVersionStatus(engine);
  useEffect(() => {
    capture(value);
  });
  return null;
}

function FlowProbe({ engine, capture }: { engine: string; capture: (v: CliUpdateFlow) => void }) {
  const flow = useCliUpdateFlow(engine);
  useEffect(() => {
    capture(flow);
  });
  return null;
}

describe("useCliVersionStatus session store", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let latest: CliVersionStatusView;
  const capture = (v: CliVersionStatusView) => {
    latest = v;
  };

  beforeEach(() => {
    resetCliStatusForTests();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.signedIn.mockResolvedValue({
      engine: "x",
      installed: true,
      signedIn: true,
      detail: null,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
    }
    container.remove();
  });

  async function render(engine: string) {
    const nextRoot = createRoot(container);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(<Probe engine={engine} capture={capture} />);
    });
  }

  it("shares one probe between readers", async () => {
    mocks.status.mockReturnValue(deferred<CliVersionStatus>().promise);
    const twoReaders = createRoot(container);
    root = twoReaders;
    await act(async () => {
      twoReaders.render(
        <>
          <Probe engine="codex" capture={capture} />
          <Probe engine="codex" capture={capture} />
        </>,
      );
    });
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledWith("codex");
    expect(latest.loading).toBe(true);
  });

  it("repaints the cached status at once on remount and refreshes behind it", async () => {
    mocks.status.mockResolvedValue(versionStatus("claude"));
    await render("claude");
    expect(latest.status?.localVersion).toBe("2.1.228 (Claude Code)");
    expect(latest.signIn?.signedIn).toBe(true);
    const firstRoot = root!;
    await act(async () => firstRoot.unmount());
    root = null;

    const secondProbe = deferred<CliVersionStatus>();
    mocks.status.mockReturnValue(secondProbe.promise);
    await render("claude");
    expect(latest.status?.localVersion).toBe("2.1.228 (Claude Code)");
    expect(latest.loading).toBe(true);
    await act(async () => {
      secondProbe.resolve(
        versionStatus("claude", { localVersion: "2.1.229 (Claude Code)", updateAvailable: false }),
      );
    });
    expect(latest.status?.localVersion).toBe("2.1.229 (Claude Code)");
    expect(latest.loading).toBe(false);
  });

  it("an update runs the installer and then probes again", async () => {
    mocks.status.mockResolvedValue(versionStatus("kimi"));
    mocks.update.mockResolvedValue({ ok: true, version: "2.1.267" });
    await render("kimi");
    const probesBefore = mocks.status.mock.calls.length;
    await act(async () => {
      await latest.update("run-1");
    });
    expect(mocks.update).toHaveBeenCalledWith("kimi", "run-1");
    expect(mocks.status.mock.calls.length).toBe(probesBefore + 1);
    expect(latest.updating).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("a failed update says why, rejects, and doesn't probe again", async () => {
    mocks.status.mockResolvedValue(versionStatus("pi"));
    mocks.update.mockRejectedValue(new Error("npm boom"));
    await render("pi");
    const probesBefore = mocks.status.mock.calls.length;
    await act(async () => {
      await expect(latest.update("run-2")).rejects.toThrow("npm boom");
    });
    expect(latest.error).toBe("npm boom");
    expect(latest.updating).toBe(false);
    expect(mocks.status.mock.calls.length).toBe(probesBefore);
  });

  it("a maker's installer runs in the app, then checks again on Done", async () => {
    mocks.status.mockResolvedValue(versionStatus("claude"));
    mocks.update.mockResolvedValue({ ok: true, version: "2.1.267" });
    mocks.updatePlan.mockResolvedValue({
      engine: "claude",
      action: "update",
      kind: "native",
      steps: ["Download Claude Code from downloads.claude.ai"],
      needsHelper: false,
      canRun: true,
      blockers: [],
      platform: "macos",
    });
    let flow!: CliUpdateFlow;
    const flowRoot = createRoot(container);
    root = flowRoot;
    await act(async () => {
      flowRoot.render(<FlowProbe engine="claude" capture={(value) => (flow = value)} />);
    });
    await act(async () => flow.begin());
    expect(flow.state.status).toBe("ready");
    await act(async () => flow.confirm());
    expect(mocks.update).toHaveBeenCalledWith("claude", expect.any(String));
    expect(flow.state.status).toBe("done");
    const probesBefore = mocks.status.mock.calls.length;
    await act(async () => flow.checkAgain());
    expect(flow.state.status).toBe("idle");
    expect(mocks.status.mock.calls.length).toBe(probesBefore + 1);
  });

  it("an install that needs Node.js starts on the helper step", async () => {
    mocks.status.mockResolvedValue(versionStatus("gemini", { installed: false }));
    const run = deferred<{ ok: boolean; version: string | null }>();
    mocks.update.mockReturnValue(run.promise);
    mocks.updatePlan.mockResolvedValue({
      engine: "gemini",
      action: "install",
      kind: "npm",
      steps: ["Download Node.js", "npm install --prefix ~/.misty/engines/gemini"],
      needsHelper: true,
      canRun: true,
      blockers: [],
      platform: "macos",
    });
    let flow!: CliUpdateFlow;
    const flowRoot = createRoot(container);
    root = flowRoot;
    await act(async () => {
      flowRoot.render(<FlowProbe engine="gemini" capture={(value) => (flow = value)} />);
    });
    await act(async () => flow.begin());
    let confirmed!: Promise<void>;
    await act(async () => {
      confirmed = flow.confirm();
    });
    expect(flow.state.status).toBe("running");
    expect(flow.state.step).toBe("helper");
    await act(async () => {
      run.resolve({ ok: true, version: "1.0.0" });
      await confirmed;
    });
    expect(flow.state.status).toBe("done");
  });
});
