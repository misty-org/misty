import { openWebTabs, pageLabel, wakeWebTab, webTabOfScope } from "@/features/browser";
import { deviceOffline, invalidRequest, notAllowed } from "./device_failures";
import { browserSessionMs, buildDeviceJob, settleDeviceJob } from "./device_job";
import type { LocalToolRequest } from "./host";
import {
  joinRunTabs,
  loadRunEntry,
  openedTabs,
  sessionTarget,
  withRunLock,
  type RunEntry,
} from "./run_contexts";
import { computerName, requireDesktopRun } from "./screen_tools";

export async function runTabList(_request: LocalToolRequest, entry: RunEntry) {
  requireDesktopRun(entry);
  const tabs = openWebTabs().map((tab) => ({
    scopeId: tab.scopeId,
    title: pageLabel(tab.url, tab.title),
    url: tab.url,
  }));
  return {
    tabs,
    message: tabs.length
      ? "These are the person's own tabs. To read or act in one, call browser_tab_use with its scopeId."
      : "The person has no web pages open in Misty's browser.",
  };
}

export function runTabUse(request: LocalToolRequest, started: RunEntry) {
  requireDesktopRun(started);
  const scopeId = typeof request.input.scopeId === "string" ? request.input.scopeId : "";
  const reason = typeof request.input.reason === "string" ? request.input.reason.trim() : "";
  const tab = webTabOfScope(scopeId);
  if (!tab)
    throw invalidRequest("That tab isn't open. List the person's tabs with browser_tab_list.");
  return withRunLock(started.runId, async () => {
    const entry = await loadRunEntry(started.runId);
    const target = entry && sessionTarget(entry);
    if (!entry || !target) throw notAllowed();
    if (entry.contexts.some((item) => item.opaqueRef === scopeId))
      return {
        status: "open",
        scopeId,
        message: `You're already working in this tab (scopeId ${scopeId}).`,
      };
    if (!tab.viewId && !(await wakeWebTab(tab.id, tab.spaceId)))
      throw invalidRequest("That tab couldn't open its page. Ask the person to open it again.");
    const name = await computerName();
    const outcome = await settleDeviceJob(
      buildDeviceJob({
        entry,
        context: target,
        callId: request.callId,
        node: "browser_session",
        operation: "browser.session",
        input: {
          scopeId: target.opaqueRef,
          reason,
          conversationId: entry.conversationId,
          useScope: scopeId,
        },
        config: { agentId: entry.agentId || "misty-unified" },
        waitMs: browserSessionMs,
      }),
      request.signal,
    );
    if (!outcome.ok) throw deviceOffline(name, "couldn't hand over that tab.");
    const tabs = openedTabs(outcome.output.tabs, target.deviceId, 1);
    if (!tabs) throw deviceOffline(name, "returned an invalid browser session.");
    await joinRunTabs(entry.runId, tabs, { person_tab: "true" });
    return {
      status: "open",
      scopeId,
      catalog_changed: true,
      message:
        `You're working in the person's tab "${pageLabel(tab.url, tab.title)}" (scopeId ${scopeId}). ` +
        "Browser tools act on it from your next step; pass its scopeId. They see what you do there " +
        "and can take it back at any time.",
    };
  });
}
