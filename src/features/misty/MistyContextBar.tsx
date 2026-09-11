import { runtimeAiApi } from "@/features/agents/agentsRuntime";
import { screenStatus } from "./screenContext";
import { useEffect, useState } from "react";
import { useMistyStore } from "./useMistyStore";
import { useSpacesStore } from "@/features/spaces/core";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { requestHostContext } from "./contextBridge";
import type { MistyContextTarget } from "./context";
import { assertMistyAvailable, currentMistySpace } from "./availability";

export function MistyContextBar() {
  const notice = useMistyStore((s) => s.handoff?.notice);
  const accountId = useMistyStore((s) => s.accountId);
  const selectedSpaceId = useMistyStore((s) => s.selectedSpaceId) || currentMistySpace();
  const targets = useMistyStore((s) => s.targets);
  const pendingArtifact = useMistyStore((s) => s.pendingArtifact);
  const invocationId = useMistyStore((s) => s.invocationId);
  const screenLabel = useMistyStore((s) => s.screenLabel);
  const captureEnabled = useMistyStore((s) => s.captureEnabled);
  const working = useMistyStore((s) => s.working);
  const spaces = useSpacesStore((s) => s.spaces);
  const [options, setOptions] = useState<Array<{ label: string; target: MistyContextTarget }>>([]);
  const [undo, setUndo] = useState<{
    id: string;
    title: string;
    expiresAt: string;
    paneId: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selectedSpaceId || !accountId) return;
    let active = true;
    void useAppsStore.getState().load(accountId, false, selectedSpaceId);
    void requestHostContext<typeof options>({
      accountId,
      spaceId: selectedSpaceId,
      targets: [],
      options: true,
    })
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [accountId, selectedSpaceId]);
  return (
    <div className="border-b border-charcoal-border px-3 py-2 text-xs text-cream-muted">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-cream">Misty</span>
        <select
          aria-label="Misty Space"
          value={selectedSpaceId}
          disabled={working}
          className="max-w-40 bg-charcoal-card p-1"
          onChange={(event) => {
            const spaceId = event.target.value;
            useMistyStore.setState({
              selectedSpaceId: spaceId,
              targets: [],
              context: [],
              handoff: undefined,
              browserRequest: undefined,
              activeConversationId: "",
            });
          }}
        >
          <option value="">Select Space</option>
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Attach workspace context"
          value=""
          disabled={working || !selectedSpaceId}
          className="max-w-52 bg-charcoal-card p-1"
          onChange={(event) => {
            const option = options[Number(event.target.value)];
            if (option)
              useMistyStore.setState({
                targets: [...(targets ?? []), option.target],
                handoff: undefined,
              });
          }}
        >
          <option value="">Attach context…</option>
          {options.map((option, index) => (
            <option key={index} value={index}>
              {option.label}
            </option>
          ))}
        </select>
        <span>{targets?.length ? `${targets.length} attached` : "Focused pane"}</span>
        <button
          disabled={working}
          aria-pressed={!!captureEnabled}
          className="underline"
          onClick={() => {
            if (captureEnabled) {
              useMistyStore.setState({ captureEnabled: false });
              setError("");
              return;
            }
            void screenStatus(true)
              .then((status) => {
                if (!status.supported)
                  throw new Error("Screen context requires macOS 14 or later.");
                if (!status.allowed)
                  throw new Error("Allow Screen Recording in System Settings, then retry.");
                useMistyStore.setState({ captureEnabled: true });
                setError("");
              })
              .catch((reason) => setError(String(reason)));
          }}
        >
          {captureEnabled ? "Screen context: On · Turn off" : "Enable screen context"}
        </button>
        <span className="ml-auto">Private</span>
      </div>
      {targets?.map((target, index) => (
        <button
          key={index}
          className="mr-2 mt-1 underline"
          disabled={working}
          onClick={() => useMistyStore.setState({ targets: targets.filter((_, i) => i !== index) })}
        >
          {options.find((option) => JSON.stringify(option.target) === JSON.stringify(target))
            ?.label ?? target.kind}{" "}
          · Remove
        </button>
      ))}
      {screenLabel && captureEnabled && <p className="mt-1">Last capture: {screenLabel}</p>}
      {working && invocationId && (
        <button
          className="mt-1 underline"
          onClick={() =>
            void runtimeAiApi
              .cancelInvocation(invocationId)
              .catch((reason) => setError(String(reason)))
          }
        >
          Cancel task
        </button>
      )}
      {pendingArtifact && (
        <div className="mt-2">
          <p className="text-cream">{pendingArtifact.title}</p>
          <p>{pendingArtifact.summary}</p>
          <details className="mt-1">
            <summary>Review proposed change</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(pendingArtifact.operations, null, 2)}
            </pre>
          </details>
          {(["accept", "reject"] as const).map((decision) => (
            <button
              key={decision}
              className="mr-3 mt-1 underline"
              onClick={() => {
                const paneId = useMistyStore.getState().artifactPaneId;
                const run = assertMistyAvailable(accountId, selectedSpaceId).then<unknown>(() =>
                  paneId
                    ? requestHostContext<
                        { id: string; title: string; expiresAt: string } | undefined
                      >({
                        accountId,
                        spaceId: selectedSpaceId,
                        targets: [],
                        paneId,
                        decision,
                        artifactId: pendingArtifact.id,
                      })
                    : runtimeAiApi.decideArtifact(
                        pendingArtifact.id,
                        decision,
                        `misty-${pendingArtifact.id}-${decision}`,
                      ),
                );
                void run
                  .then((receipt) => {
                    if (
                      paneId &&
                      receipt &&
                      typeof receipt === "object" &&
                      "id" in receipt &&
                      "title" in receipt &&
                      "expiresAt" in receipt &&
                      typeof receipt.id === "string" &&
                      typeof receipt.title === "string" &&
                      typeof receipt.expiresAt === "string"
                    )
                      setUndo({
                        id: receipt.id,
                        title: receipt.title,
                        expiresAt: receipt.expiresAt,
                        paneId,
                      });
                    useMistyStore.setState({ pendingArtifact: undefined });
                  })
                  .catch((reason) => setError(String(reason)));
              }}
            >
              {decision === "accept" ? "Approve" : "Reject"}
            </button>
          ))}
        </div>
      )}
      {undo && Date.parse(undo.expiresAt) > Date.now() && (
        <button
          className="mt-2 underline"
          onClick={() =>
            void requestHostContext({
              accountId,
              spaceId: selectedSpaceId,
              targets: [],
              paneId: undo.paneId,
              undoId: undo.id,
            })
              .then(() => setUndo(undefined))
              .catch((reason) => setError(String(reason)))
          }
        >
          {undo.title}
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="status" className="mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
