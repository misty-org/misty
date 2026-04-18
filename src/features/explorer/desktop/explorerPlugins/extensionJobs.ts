import { extensionCommandRun } from "@/stores/backend";
import { useExplorerStore } from "@/stores/explorer";

const monitoredExtensionJobs = new Map<string, number>();

export function monitorExtensionJob(pluginId: string, pluginName: string, jobId: string) {
  const key = `${pluginId}:${jobId}`;
  if (monitoredExtensionJobs.has(key)) return;
  const poll = () => {
    void extensionCommandRun({ pluginId, command: "jobs.status", payload: { jobId } })
      .then((result) => {
        const snapshot = result as { status?: string; message?: string; error?: string };
        if (snapshot.status === "queued" || snapshot.status === "running") {
          monitoredExtensionJobs.set(key, window.setTimeout(poll, 1_200));
          return;
        }
        monitoredExtensionJobs.delete(key);
        const successful = snapshot.status === "completed";
        useExplorerStore
          .getState()
          .pushNotification(
            snapshot.error ||
              snapshot.message ||
              `${pluginName} job ${successful ? "completed" : "stopped"}.`,
            successful ? "success" : "error",
            5_500,
          );
      })
      .catch(() => {
        monitoredExtensionJobs.set(key, window.setTimeout(poll, 2_000));
      });
  };
  monitoredExtensionJobs.set(key, window.setTimeout(poll, 800));
}
