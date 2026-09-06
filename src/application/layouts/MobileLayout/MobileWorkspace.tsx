import { peerIsOnline, useConnectedDevices } from "@/features/connected-devices";
import {
  WorkspaceTabTitleProvider,
  dockLeaves,
  useWorkspaceStore,
} from "@/features/workspace/core";
import { connectedDevicesOpenWorkspaceRoute } from "@/native/connected-devices";
import type { WorkspaceRouteSurface } from "@/native/contracts";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui";
import { ArrowUpRight, MonitorUp } from "lucide-react";
import { useMemo, useState } from "react";
import { MobileWorkspaceSurface } from "./MobileWorkspaceSurface";

export function MobileWorkspace() {
  const activeTab = useWorkspaceStore((state) => {
    const panes = dockLeaves(state.layout.root);
    const pane = panes.find((candidate) => candidate.id === state.layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane?.tabs[0] ?? null;
  });

  if (!activeTab) return null;
  if (
    activeTab.surfaceId === "code" ||
    activeTab.surfaceId === "terminal" ||
    activeTab.surfaceId === "transfers"
  ) {
    return (
      <DesktopHandoffState
        title={activeTab.title}
        route={activeTab.route}
        surface={activeTab.surfaceId}
      />
    );
  }

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-charcoal-bg" data-mobile-workspace>
      <WorkspaceTabTitleProvider tabId={activeTab.id}>
        <MobileWorkspaceSurface tab={activeTab} active />
      </WorkspaceTabTitleProvider>
    </div>
  );
}

function DesktopHandoffState(props: {
  title: string;
  route: string;
  surface: WorkspaceRouteSurface;
}) {
  const connected = useConnectedDevices();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyDeviceId, setBusyDeviceId] = useState("");
  const [message, setMessage] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const onlineDesktops = useMemo(
    () =>
      connected.peers.filter((peer) => {
        const native = connected.snapshot?.peers.find((item) => item.deviceId === peer.deviceId);
        return (
          (peer.platform === "macos" || peer.platform === "windows") &&
          peerIsOnline(peer) &&
          native?.state === "online"
        );
      }),
    [connected.peers, connected.snapshot?.peers],
  );

  const send = async (deviceId: string) => {
    if (!connected.localServerDeviceId) {
      setMessage("Connected Devices is still starting. Try again in a moment.");
      return;
    }
    setBusyDeviceId(deviceId);
    setMessage("");
    try {
      const result = await connectedDevicesOpenWorkspaceRoute(deviceId, {
        requestId: createRequestId(),
        route: props.route,
        surface: props.surface,
        sentAt: new Date().toISOString(),
        sourceDeviceId: connected.localServerDeviceId,
        sourceDeviceName: connected.localDeviceName,
      });
      setMessage(result.reason);
      if (result.status === "opened") setPickerOpen(false);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The desktop could not be reached.");
    } finally {
      setBusyDeviceId("");
    }
  };

  const chooseDesktop = () => {
    if (onlineDesktops.length === 1) void send(onlineDesktops[0].deviceId);
    else setPickerOpen(true);
  };

  return (
    <>
      <div className="grid h-full place-items-center bg-charcoal-bg px-7 text-center">
        <div className="max-w-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-charcoal-card text-cream-bright">
            <MonitorUp size={22} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-lg font-semibold tracking-[-0.02em] text-cream-bright">
            Continue {props.title} on desktop
          </h1>
          <p className="mt-2 text-sm leading-6 text-cream-muted">
            This tool needs a desktop environment. Connect an online computer to open it there.
          </p>
          <button
            type="button"
            className="mx-auto mt-5 flex min-h-11 items-center gap-2 rounded-md bg-charcoal-active px-4 text-sm font-medium text-cream-bright disabled:opacity-50"
            disabled={Boolean(busyDeviceId)}
            onClick={chooseDesktop}
          >
            {busyDeviceId
              ? "Opening…"
              : onlineDesktops.length === 1
                ? `Open on ${onlineDesktops[0].name}`
                : "Choose a desktop"}
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
          {message ? (
            <p className="mt-3 text-sm text-cream-muted" role="status">
              {message}
            </p>
          ) : null}
        </div>
      </div>
      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[min(72dvh,620px)] rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>Open on desktop</SheetTitle>
          </SheetHeader>
          {onlineDesktops.length ? (
            <div className="grid gap-1">
              {onlineDesktops.map((peer) => (
                <button
                  key={peer.pairId}
                  type="button"
                  className="flex min-h-14 items-center gap-3 rounded-lg px-3 text-left text-cream-bright active:bg-charcoal-card"
                  disabled={Boolean(busyDeviceId)}
                  onClick={() => void send(peer.deviceId)}
                >
                  <MonitorUp size={20} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{peer.name}</span>
                  <span className="text-xs text-sage-fg">Online</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-2">
              <p className="text-sm leading-6 text-cream-muted">
                No paired desktop is online. Open Misty on a computer, or pair one now. Handoff
                requests are never queued.
              </p>
              <button
                type="button"
                className="mt-4 min-h-11 rounded-md bg-charcoal-active px-4 text-sm font-medium text-cream-bright"
                onClick={() => {
                  void connected
                    .createPairing()
                    .then((result) => setPairingCode(result.manualCode || result.deepLink || ""))
                    .catch((cause) =>
                      setMessage(
                        cause instanceof Error ? cause.message : "Pairing could not start.",
                      ),
                    );
                }}
              >
                Pair a desktop
              </button>
              {pairingCode ? (
                <p className="mt-4 rounded-lg bg-charcoal-card p-3 font-mono text-sm text-cream-bright">
                  {pairingCode}
                </p>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
