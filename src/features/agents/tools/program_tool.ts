import { deviceWorkflowErrorCode } from "../runs/jobs/worker_device_jobs";
import { deviceOffline, invalidRequest } from "./device_failures";
import { browserRunMs, browserToolConfig, buildDeviceJob, settleDeviceJob } from "./device_job";
import type { LocalToolRequest } from "./host";
import {
  contextAllows,
  joinRunTabs,
  openedTabs,
  sessionTarget,
  withRunLock,
  type RunEntry,
} from "./run_contexts";
import { computerName, requireDesktopRun } from "./screen_tools";

export async function runProgramTool(request: LocalToolRequest, entry: RunEntry) {
  const code = typeof request.input.code === "string" ? request.input.code : "";
  if (!code.trim() || code.length > 20_000) {
    throw invalidRequest("Pass the program as code (1–20000 characters).");
  }
  requireDesktopRun(entry);
  const target = sessionTarget(entry);
  if (!target || !contextAllows(target, "browser.run")) {
    throw invalidRequest(
      "This run has no browser of its own on this computer, so browser_run is not available; use screen_open and the page tools.",
    );
  }
  const outcome = await settleDeviceJob(
    buildDeviceJob({
      entry,
      context: target,
      callId: request.callId,
      node: "browser_run",
      operation: "browser.run",
      input: {
        scopeId: target.opaqueRef,
        conversationId: entry.conversationId,
        code,
        ...(typeof request.input.saveAs === "string" ? { saveAs: request.input.saveAs } : {}),
      },
      config: browserToolConfig(entry, request.policyCall),
      waitMs: browserRunMs,
    }),
    request.signal,
  );
  if (!outcome.ok) {
    if (outcome.stopped) throw deviceOffline(await computerName(), "did not finish the program.");
    return {
      ok: false,
      error:
        `The program did not run to the end on the device (${deviceWorkflowErrorCode(outcome.error)}). ` +
        `What it did before stopping may have happened; read your tabs before running it again.`,
    };
  }
  const { opened, ...output } = outcome.output;
  if (Array.isArray(opened) && opened.length) {
    const tabs = openedTabs(opened, target.deviceId, opened.length);
    const joined = tabs
      ? await withRunLock(entry.runId, () => joinRunTabs(entry.runId, tabs)).catch(() => null)
      : null;
    if (!joined) {
      output.tabsNote =
        "Some tabs the program opened could not join the run: a tab the device opened is invalid";
    }
    output.catalog_changed = true;
  }
  return output;
}
