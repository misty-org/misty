import type { OperationQueueSnapshot, OperationDescriptor } from "@/native/contracts";
import { useActivityStore } from "./useActivityStore";
import { belongsToActivityAccount } from "./activityState";

/** Only queued background jobs; foreground rename/create/delete feedback stays local. */
export function createOperationActivityObserver() {
  const ignored = new Set<string>();
  let baselined = false;
  return (snapshot: OperationQueueSnapshot, accountId: string) => {
    const state = useActivityStore.getState();
    if (state.accountId !== accountId) return;
    const groups = new Map<string, OperationDescriptor[]>();
    for (const operation of snapshot.operations) {
      if (!["copy", "move", "upload", "download", "archive"].includes(operation.kind)) continue;
      const key = operation.batchId
        ? `batch:${operation.batchId}`
        : `operation:${operation.operationId}`;
      groups.set(key, [...(groups.get(key) ?? []), operation]);
    }
    for (const [key, jobs] of groups) {
      const id = `native-job:${key}`;
      const previous = state.localItems.find(
        (item) => item.sourceId === id && belongsToActivityAccount(item, state),
      );
      // Do not attribute pre-existing device work to a newly signed-in account.
      if (!baselined && !previous) ignored.add(key);
      if (ignored.has(key)) continue;
      const failed = jobs.some((job) => ["failed", "waiting_for_resolution"].includes(job.status));
      const complete = jobs.every((job) => ["completed", "skipped"].includes(job.status));
      const canceled = jobs.every((job) =>
        ["completed", "skipped", "canceled"].includes(job.status),
      );
      const status = failed
        ? "blocked"
        : complete
          ? "completed"
          : canceled
            ? "resolved"
            : "running";
      const label =
        snapshot.batches.find((batch) => `batch:${batch.batchId}` === key)?.label ||
        "File transfer";
      state.ingestLocal({
        id,
        accountId,
        appId: "files",
        sourceLabel: "Files",
        status,
        kind: failed ? "failure" : complete ? "completion" : "system",
        lifecycle: failed ? "request" : "update",
        title: `${label} ${failed ? "needs attention" : complete ? "completed" : canceled ? "canceled" : "in progress"}`,
        body: failed
          ? "Open Transfers to resolve the conflict or retry the job."
          : `${jobs.length} ${jobs.length === 1 ? "operation" : "operations"}`,
        target: { kind: "route", href: "/apps/files?view=transfers" },
        notify: baselined,
      });
    }
    baselined = true;
  };
}
