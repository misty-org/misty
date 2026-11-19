import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  ChoiceList,
  ConfirmDeleteDialog,
  IconButton,
  ListRow,
  ListRowSkeleton,
  notify,
  ScrollArea,
  SectionHeading,
  Spinner,
  Text,
  TopBar,
} from "@/shared/ui";
import { liveErrorText } from "./liveApi";
import type { CommitPreview } from "./liveCommits";
import { endSession, previewEnd, type EndStage } from "./liveEnd";
import { useLiveStore } from "./liveStore";
import type { LiveJoin, LiveOutcome } from "./liveTypes";

const stageWords: Record<EndStage, string> = {
  commits: "Making a commit for each person",
  merge: "Merging main into the session",
  land: "Merging the session into main",
  push: "Pushing the branch",
  "pull request": "Opening a pull request",
  close: "Closing the session",
};

const doneWords: Record<LiveOutcome, string> = {
  merged: "Merged into main. Push main when you're ready.",
  pr: "Pull request opened.",
  kept: "Kept as a branch.",
  discarded: "Session discarded.",
};

/**
 * Ending the session, for its starter: how it ends, the commits it makes (one per person, and
 * one shared where people wrote the same lines), then the work, step by step, where it happens.
 */
export function LiveEndFlow({ join }: { join: LiveJoin }) {
  const [outcome, setOutcome] = useState<LiveOutcome>("pr");
  const [preview, setPreview] = useState<CommitPreview[] | null>(null);
  const [stage, setStage] = useState<EndStage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    previewEnd(join)
      .then((plan) => live && setPreview(plan.preview))
      .catch((reason) => live && setError(liveErrorText(reason)));
    return () => {
      live = false;
    };
  }, [join]);

  const close = () => useLiveStore.getState().setEnding(false);
  const run = async () => {
    setError("");
    setNotice("");
    try {
      const result = await endSession(join, outcome, setStage);
      if (result.kind === "blocked") setError(result.reason);
      else if (result.kind === "conflicts")
        setNotice(
          `Main conflicts with the session in ${result.paths.join(", ")}. The conflicts are in the session now: settle them together, then end it again.`,
        );
      else {
        const url = result.url;
        notify({
          message: doneWords[result.outcome],
          action: url
            ? { label: "Open", onSelect: () => void openUrl(url).catch(() => undefined) }
            : undefined,
        });
      }
    } catch (reason) {
      setError(liveErrorText(reason));
    } finally {
      setStage(null);
    }
  };

  const options: Array<{ value: LiveOutcome; label: string; description: string }> = [
    {
      value: "merged",
      label: "Merge into main",
      description: "Main is merged in first, then the session lands on main in your checkout.",
    },
    {
      value: "pr",
      label: "Open a pull request",
      description: "The branch is pushed to origin and a pull request opens for it.",
    },
    {
      value: "kept",
      label: "Keep as a branch",
      description: `The commits stay on ${join.branch} in your copy.`,
    },
    {
      value: "discarded",
      label: "Discard",
      description: "Nothing is committed. The session's changes are gone for everyone.",
    },
  ];
  const working = stage !== null;
  return (
    <div className="flex size-full min-h-0 flex-col">
      <TopBar
        aria-label="End session"
        divider
        start={
          <Text size="control" weight="medium">
            {`End ${join.name}`}
          </Text>
        }
      >
        <IconButton label="Close" disabled={working} onClick={close}>
          <X />
        </IconButton>
      </TopBar>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto grid w-full max-w-xl gap-6 px-4 py-6">
          <ChoiceList
            label="How the session ends"
            options={options}
            selected={[outcome]}
            disabled={working}
            onSelect={(value) => setOutcome(value as LiveOutcome)}
          />
          {outcome !== "discarded" ? (
            <div className="grid">
              <SectionHeading title="Commits" count={preview?.length} />
              {preview === null ? (
                <ListRowSkeleton label="Commits" rows={2} lines={2} />
              ) : preview.length ? (
                preview.map((commit) => (
                  <ListRow
                    key={commit.group}
                    label={
                      commit.group === "shared"
                        ? `Together: ${commit.names.join(", ")}`
                        : commit.names.join(", ")
                    }
                    description={`${commit.paths.join(", ")} · +${commit.plus} −${commit.minus}`}
                  />
                ))
              ) : (
                <Text size="meta" tone="muted" className="px-2">
                  Nothing changed since the session started.
                </Text>
              )}
            </div>
          ) : null}
          {stage ? (
            <div className="flex items-center gap-2" role="status">
              <Spinner label={false} />
              <Text size="meta" tone="muted">
                {stageWords[stage]}
              </Text>
            </div>
          ) : null}
          {notice ? (
            <Text size="meta" tone="default" wrap>
              {notice}
            </Text>
          ) : null}
          {error ? (
            <Text size="meta" tone="danger" wrap>
              {error}
            </Text>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="quiet" disabled={working} onClick={close}>
              Cancel
            </Button>
            <Button
              variant={outcome === "discarded" ? "danger" : "primary"}
              disabled={working}
              onClick={() => (outcome === "discarded" ? setConfirming(true) : void run())}
            >
              End session
            </Button>
          </div>
        </div>
      </ScrollArea>
      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Discard ${join.name}?`}
        what="The session ends for everyone and its changes are gone. This can't be undone."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirming(false);
          void run();
        }}
      />
    </div>
  );
}
