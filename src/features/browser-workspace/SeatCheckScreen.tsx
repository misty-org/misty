import { BlockingScreen, Button } from "@/shared/ui";
import mistyStill from "@/assets/branding/misty-icon.png?inline";
import type { NativeSyncView } from "./native";
import { syncIssueMessage } from "./syncIssueMessage";

/** Shown while this device cannot prove it is the only one writing to its
 * workspace: another device may have taken it while this one was away. */
export function SeatCheckScreen({
  session,
  retrying,
  onRetry,
}: {
  session: NativeSyncView;
  retrying: boolean;
  onRetry: () => void;
}) {
  const stopped = session.status.phase === "attention" || session.status.phase === "stopped";
  return (
    <BlockingScreen
      attributes={{ "data-device-sync-seat-check": "" }}
      media={
        <img
          src={mistyStill}
          alt=""
          width={120}
          height={120}
          draggable={false}
          className="mb-5 size-28 select-none object-contain"
        />
      }
      title="Checking who’s using this workspace"
      description={
        stopped
          ? "Sync stopped, so Misty can’t confirm that no other device is using this workspace. Browsing is paused until it can."
          : "Misty can’t reach sync to confirm that no other device is using this workspace. Browsing resumes as soon as it reconnects."
      }
    >
      <div className="mt-6 flex max-w-sm flex-col items-center gap-3 text-sm" aria-live="polite">
        {session.status.issue && (
          <p role="alert" className="text-red-300">
            {syncIssueMessage(session.status.issue)}
          </p>
        )}
        <Button variant="outline" disabled={retrying} onClick={onRetry}>
          {retrying ? "Reconnecting…" : "Reconnect now"}
        </Button>
      </div>
    </BlockingScreen>
  );
}
