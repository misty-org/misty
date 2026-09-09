import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useNativeAppPermissions } from "./useNativeAppPermissions";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  granted: false,
  expired: false,
  theme: vi.fn(),
  revertTheme: vi.fn(),
  revoked: undefined as
    undefined | ((event: { payload: { instance: string; capability?: string } }) => void),
}));
vi.mock("@/features/settings", () => ({
  runExtensionThemeCommand: mocks.theme,
  revertExtensionThemePreview: mocks.revertTheme,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation((_event, handler) => {
    mocks.revoked = handler;
    return Promise.resolve(() => undefined);
  }),
}));
beforeEach(() => {
  mocks.theme.mockReset().mockReturnValue({ ok: true, message: "Theme updated" });
  mocks.revertTheme.mockReset();
  mocks.granted = false;
  mocks.expired = false;
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "mini_app_permission_status")
      return { appId: "example", capability: "clipboard.read", granted: mocks.granted };
    if (command === "mini_app_permission_decide") {
      mocks.granted = args.allowed;
      return;
    }
    if (command === "mini_app_permission_list") return mocks.granted ? ["clipboard.read"] : [];
    if (command === "mini_app_device_call") {
      if (!mocks.granted) throw new Error("Denied");
      return { text: "App-visible clipboard" };
    }
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Harness({ signal }: { signal?: AbortSignal }) {
  const permissions = useNativeAppPermissions("Example");
  const [result, setResult] = useState("");
  return (
    <>
      <button
        onClick={() => {
          void permissions
            .execute(
              "instance",
              "clipboard.readText",
              {},
              () => {
                if (mocks.expired) throw new Error("Session expired");
              },
              signal,
            )
            .then(
              (value) => setResult(JSON.stringify(value)),
              (error) => setResult(String(error)),
            );
        }}
      >
        Read clipboard
      </button>
      <button
        onClick={() => {
          void permissions.open("instance");
        }}
      >
        Permissions
      </button>
      <button
        onClick={() => {
          void permissions.execute("instance", "microphone.capture", { seconds: 30 }).then(
            (value) => setResult(JSON.stringify(value)),
            (error) => setResult(String(error)),
          );
        }}
      >
        Record
      </button>
      <button
        onClick={() => {
          void permissions
            .execute(
              "instance",
              "appearance.preview",
              { tokens: { accent: "#AABBCC" } },
              () => {
                if (mocks.expired) throw new Error("Session expired");
              },
              signal,
            )
            .then(
              (value) => setResult(JSON.stringify(value)),
              (error) => setResult(String(error)),
            );
        }}
      >
        Preview theme
      </button>
      <output>{result}</output>
      {permissions.controls}
    </>
  );
}
it("does not access a device before explicit approval, then supports revocation", async () => {
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Read clipboard"));
  await view.findByText("Allow for this session");
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_device_call")).toBe(
    false,
  );
  fireEvent.click(view.getByText("Allow for this session"));
  await waitFor(() => expect(view.getByText(/App-visible clipboard/)).toBeTruthy());
  fireEvent.click(view.getByText("Permissions"));
  fireEvent.click(await view.findByText("Revoke"));
  await waitFor(() => expect(mocks.granted).toBe(false));
  expect(mocks.invoke).toHaveBeenCalledWith("mini_app_permission_decide", {
    instance: "instance",
    capability: "clipboard.read",
    allowed: false,
  });
});
it("a timed-out request dismisses its prompt without granting access", async () => {
  const abort = new AbortController();
  const view = render(<Harness signal={abort.signal} />);
  fireEvent.click(view.getByText("Read clipboard"));
  await view.findByText("Allow for this session");
  abort.abort();
  await view.findByText(/Permission was not granted/);
  expect(view.queryByText("Allow for this session")).toBeNull();
  expect(mocks.granted).toBe(false);
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_device_call")).toBe(
    false,
  );
});
it("denial and expired sessions never perform the requested operation", async () => {
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Read clipboard"));
  fireEvent.click(await view.findByText("Don’t allow"));
  await view.findByText(/Permission was not granted/);
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_device_call")).toBe(
    false,
  );
  fireEvent.click(view.getByText("Read clipboard"));
  await view.findByText("Allow for this session");
  mocks.expired = true;
  fireEvent.click(view.getByText("Allow for this session"));
  await view.findByText(/Session expired/);
  expect(mocks.granted).toBe(false);
});
it("closing an App cancels a pending permission decision", async () => {
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Read clipboard"));
  await view.findByText("Allow for this session");
  view.unmount();
  await waitFor(() => expect(mocks.granted).toBe(false));
  expect(mocks.invoke.mock.calls.some(([command]) => command === "mini_app_device_call")).toBe(
    false,
  );
});

it("revocation stops active capture and discards its result", async () => {
  mocks.granted = true;
  const stop = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    "MediaRecorder",
    class {
      state = "inactive";
      mimeType = "audio/test";
      onstop?: () => void;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    },
  );
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Record"));
  await view.findByText("Example is recording");
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  mocks.revoked?.({ payload: { instance: "instance" } });
  await view.findByText(/Recording cancelled or permission revoked/);
  expect(stop).toHaveBeenCalled();
});

it("appearance changes need approval and closing removes only this instance's preview", async () => {
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Preview theme"));
  await view.findByText("Allow for this session");
  expect(mocks.theme).not.toHaveBeenCalled();
  fireEvent.click(view.getByText("Allow for this session"));
  await view.findByText(/Theme updated/);
  expect(mocks.theme).toHaveBeenCalledWith(
    "themes.preview",
    { tokens: { accent: "#AABBCC" } },
    "instance",
  );
  view.unmount();
  expect(mocks.revertTheme).toHaveBeenCalledWith("instance");
});
it("rechecks appearance access after approval before touching Host settings", async () => {
  const original = mocks.invoke.getMockImplementation()!;
  let checks = 0;
  mocks.invoke.mockImplementation(async (command, args) => {
    if (command === "mini_app_permission_status") {
      checks += 1;
      return { appId: "example", capability: "appearance.write", granted: false };
    }
    return original(command, args);
  });
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Preview theme"));
  fireEvent.click(await view.findByText("Allow for this session"));
  await view.findByText(/Appearance permission was revoked/);
  expect(checks).toBe(2);
  expect(mocks.theme).not.toHaveBeenCalled();
});

it("an appearance revocation removes the preview without affecting other instances", async () => {
  mocks.granted = true;
  const view = render(<Harness />);
  fireEvent.click(view.getByText("Preview theme"));
  await view.findByText(/Theme updated/);
  mocks.revoked?.({ payload: { instance: "foreign", capability: "appearance.write" } });
  expect(mocks.revertTheme).not.toHaveBeenCalled();
  mocks.revoked?.({ payload: { instance: "instance", capability: "appearance.write" } });
  expect(mocks.revertTheme).toHaveBeenCalledWith("instance");
});
