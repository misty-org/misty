import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativeAppView } from "./NativeAppView";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  native: true,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => mocks.native }));
let receive: (event: {
  payload: { instance: string; requestId: string; message: unknown };
}) => void;
let cancelRequest: (event: { payload: { instance: string; requestId: string } }) => void;
beforeEach(() => {
  mocks.native = true;
  mocks.invoke
    .mockReset()
    .mockImplementation((command) =>
      Promise.resolve(command === "mini_app_open" ? "misty-mini-app-own" : undefined),
    );
  mocks.unlisten.mockReset();
  mocks.listen.mockReset().mockImplementation((name, handler) => {
    if (name === "misty:mini-app-request") receive = handler;
    if (name === "misty:mini-app-request-cancelled") cancelRequest = handler;
    return Promise.resolve(mocks.unlisten);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
it("cancels only the timed-out native request and drops its late answer", async () => {
  const { request } = await setup();
  let finish!: () => void;
  let signal!: AbortSignal;
  request.mockImplementation((_message, suppliedSignal) => {
    signal = suppliedSignal;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await act(async () => send("misty-mini-app-own", { method: "slow" }, "slow-request"));
  await act(async () =>
    cancelRequest({ payload: { instance: "other", requestId: "slow-request" } }),
  );
  expect(signal.aborted).toBe(false);
  await act(async () =>
    cancelRequest({ payload: { instance: "misty-mini-app-own", requestId: "slow-request" } }),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_reply")).toBe(false);
});

it("closes an expired session while a request is pending", async () => {
  let signal!: AbortSignal;
  const request = vi.fn((_message, suppliedSignal: AbortSignal) => {
    signal = suppliedSignal;
    return new Promise(() => undefined);
  });
  const view = render(
    <NativeAppView
      title="Example"
      source={source}
      context={{}}
      onRequest={request}
      expiresAt="2099-01-01T00:00:00Z"
    />,
  );
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("mini_app_open", expect.anything()),
  );
  await act(async () => send("misty-mini-app-own", { method: "slow" }));
  view.rerender(
    <NativeAppView
      title="Example"
      source={source}
      context={{}}
      onRequest={request}
      expiresAt="2000-01-01T00:00:00Z"
    />,
  );
  await view.findByText(/The App session has expired/);
  expect(signal.aborted).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "misty-mini-app-own" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const source = "misty-extension://localhost/private/example/web/index.html";
async function setup() {
  const request = vi.fn().mockResolvedValue({ ok: true });
  const view = render(
    <NativeAppView
      title="Example"
      source={source}
      context={{ type: "context", theme: "dark" }}
      onRequest={request}
    />,
  );
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("mini_app_open", expect.anything()),
  );
  return { view, request };
}
function send(instance: string, message: unknown, requestId = "r") {
  receive({ payload: { instance, message, requestId } });
}
it("accepts only requests from its native registration and never creates an iframe", async () => {
  const { view, request } = await setup();
  expect(view.container.querySelector("iframe")).toBeNull();
  await act(async () => send("misty-mini-app-other", { method: "custom.echo" }));
  expect(request).not.toHaveBeenCalled();
  await act(async () => send("misty-mini-app-own", { method: "custom.echo", appId: "forged" }));
  expect(request).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_reply", {
    instance: "misty-mini-app-own",
    requestId: "r",
    result: { ok: true },
    error: null,
  });
});
it("sends host context only after startup and closes on unmount", async () => {
  const { view } = await setup();
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_post")).toBe(false);
  await act(async () => send("misty-mini-app-own", { method: "lifecycle.ready" }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("mini_app_post", {
      instance: "misty-mini-app-own",
      message: { type: "context", theme: "dark" },
    }),
  );
  view.unmount();
  expect(mocks.unlisten).toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "misty-mini-app-own" });
});
it("closes a view whose asynchronous creation finishes after unmount", async () => {
  let opened!: (value: string) => void;
  mocks.invoke.mockImplementation((command) =>
    command === "mini_app_open"
      ? new Promise<string>((resolve) => {
          opened = resolve;
        })
      : Promise.resolve(),
  );
  const { view } = await setup();
  view.unmount();
  await act(async () => opened("misty-mini-app-late"));
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "misty-mini-app-late" });
});
it("does not fall back to a browser frame on unsupported platforms", () => {
  mocks.native = false;
  const view = render(
    <NativeAppView title="Example" source={source} context={{}} onRequest={vi.fn()} />,
  );
  expect(view.getByText(/does not support it yet/)).toBeTruthy();
  expect(view.container.querySelector("iframe")).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("shows a startup error immediately and keeps the native view hidden", async () => {
  const { view } = await setup();
  await act(async () =>
    send("misty-mini-app-own", { type: "misty:app-error", message: "Bundle could not start" }),
  );
  expect(view.getByRole("alert").textContent).toContain("Bundle could not start");
  expect(view.queryByText("Opening Example…")).toBeNull();
});

it("preserves a native permission denial in the app response", async () => {
  const { request } = await setup();
  request.mockRejectedValue("Permission was revoked. Reopen the App to request it again.");
  await act(async () => send("misty-mini-app-own", { method: "test.denied" }));
  expect(mocks.invoke).toHaveBeenCalledWith(
    "mini_app_reply",
    expect.objectContaining({
      error: "Permission was revoked. Reopen the App to request it again.",
    }),
  );
});

it("registers Host account and Space ownership and closes the old view when either changes", async () => {
  const view = render(
    <NativeAppView
      title="Example"
      source={source}
      context={{ owner: { accountId: "package-spoof" } }}
      owner={{ accountId: "account-a", spaceId: "space-a" }}
      onRequest={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "mini_app_open",
      expect.objectContaining({
        request: expect.objectContaining({ owner: { accountId: "account-a", spaceId: "space-a" } }),
      }),
    ),
  );
  view.rerender(
    <NativeAppView
      title="Example"
      source={source}
      context={{}}
      owner={{ accountId: "account-b", spaceId: "space-a" }}
      onRequest={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "mini_app_open")).toHaveLength(
      2,
    ),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_close", { instance: "misty-mini-app-own" });
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "mini_app_open",
    expect.objectContaining({
      request: expect.objectContaining({ owner: { accountId: "account-b", spaceId: "space-a" } }),
    }),
  );
  view.rerender(
    <NativeAppView
      title="Example"
      source={source}
      context={{}}
      owner={{ accountId: "account-b", spaceId: "space-b" }}
      onRequest={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "mini_app_open")).toHaveLength(
      3,
    ),
  );
});
