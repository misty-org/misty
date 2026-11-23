import { publishLocalRunEvent } from "../runs/local-run/local_run_events";
import type { ScreenRequest } from "../runs/invocations/invocation_types";
import { agentsDeviceSnapshot } from "../personal/use_agents_store";
import { deviceWorkflowErrorCode } from "../runs/jobs/worker_device_jobs";
import { addressWithoutHost } from "./browser_tools";
import { deviceOffline, invalidRequest, notAllowed } from "./device_failures";
import { agentSettings, browserSessionMs, buildDeviceJob, settleDeviceJob } from "./device_job";
import type { LocalToolRequest } from "./host";
import {
  contextAllows,
  hasDesktopControl,
  joinRunTabs,
  leaveRunTab,
  loadRunEntry,
  openedTabs,
  ownTabs,
  sessionTarget,
  withRunLock,
  type RunDeviceContext,
  type RunEntry,
} from "./run_contexts";

const maxOwnTabs = 32;

export async function computerName(): Promise<string> {
  const snapshot = await agentsDeviceSnapshot().catch(() => null);
  return snapshot?.device?.displayName?.trim() || "That device";
}

function sessionOpened(
  scopeId: string,
  url: string,
  reused: boolean,
  programs: boolean,
  tabs: string[],
) {
  const place = "this computer";
  const opened = reused
    ? `Your own browser tab on ${place} is already open`
    : `Your own browser tab is open on ${place}`;
  const list = tabs.length ? tabs : [scopeId];
  const fields = { status: "open", scopeId, tabs: list, catalog_changed: true };
  if (programs) {
    return {
      ...fields,
      message:
        `${opened} (scopeId ${scopeId}). Work it with browser_run: getTab("${scopeId}") gives this ` +
        `tab in a program, openTab(url) opens another. Your open tabs: ${list.join(", ")}.`,
    };
  }
  const next =
    !url || reused
      ? "Go to pages in it with browser_navigate, which returns each page's snapshot"
      : "Its page snapshot follows, so act on it next";
  return {
    ...fields,
    message:
      `${opened} (scopeId ${scopeId}). Browser tools act on it from your next step; pass its scopeId. ` +
      `${next}, and keep working in this run. Your open tabs: ${list.join(", ")}. Each screen_open ` +
      `opens another tab (up to 32): use one for a page the person wants kept open or for each ` +
      `helper working at the same time; otherwise read other pages by navigating a tab you have.`,
  };
}

async function openOwnTab(
  request: LocalToolRequest,
  entry: RunEntry,
  target: RunDeviceContext,
  url: string,
  reason: string,
  newTab: boolean,
) {
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
        url,
        reason,
        conversationId: entry.conversationId,
        newTab,
      },
      config: { agentId: entry.agentId || "misty-unified" },
      waitMs: browserSessionMs,
    }),
    request.signal,
  );
  if (!outcome.ok) {
    if (outcome.stopped) throw deviceOffline(name, "did not answer.");
    const code = deviceWorkflowErrorCode(outcome.error);
    if (code === "agent_busy") {
      throw deviceOffline(name, "is busy with another task for this agent.");
    }
    if (code === "device_grant_invalid") throw deviceOffline(name, "refused the browser session.");
    throw deviceOffline(name, "could not open a browser.");
  }
  const tabs = openedTabs(outcome.output.tabs, target.deviceId, 1);
  if (!tabs) throw deviceOffline(name, "returned an invalid browser session.");
  await joinRunTabs(entry.runId, tabs, url ? { opened_url: url } : {});
  return tabs[0].opaqueRef;
}

function openInOwnTab(request: LocalToolRequest, runId: string, url: string, reason: string) {
  return withRunLock(runId, async () => {
    const entry = await loadRunEntry(runId);
    const target = entry && sessionTarget(entry);
    if (!entry || !target) return null;
    const programs = contextAllows(target, "browser.run");
    const own = ownTabs(entry, target.deviceId);
    const list = own.map((item) => item.opaqueRef);
    const already = url ? own.find((item) => item.metadata.opened_url === url) : undefined;
    if (already) return sessionOpened(already.opaqueRef, url, true, programs, list);
    if (own.length >= maxOwnTabs) return sessionOpened(list[0], url, true, programs, list);
    const scope = await openOwnTab(request, entry, target, url, reason.trim(), own.length > 0);
    return sessionOpened(scope, url, list.includes(scope), programs, [
      ...new Set([...list, scope]),
    ]);
  });
}

function screensOf(entry: RunEntry) {
  return entry.contexts.map(
    (item) => `${item.displayName.trim() || "Misty browser"} (scopeId ${item.opaqueRef})`,
  );
}

async function requestScreen(
  entry: RunEntry,
  kind: ScreenRequest["kind"],
  url: string,
  reason: string,
  target: string,
) {
  const settings = await agentSettings();
  const location: ScreenRequest["location"] =
    settings?.screen_location === "ask" && target !== "new_tab" && target !== "window"
      ? "ask"
      : "window";
  publishLocalRunEvent(entry.runId, {
    id: `local-${crypto.randomUUID()}`,
    type: "screen.request",
    screenRequest: {
      kind,
      ...(url ? { url } : {}),
      reason: reason.trim(),
      location,
      ...(target ? { chosen: true } : {}),
    },
  });
  return {
    status: "screen_requested",
    kind,
    message: "Misty is opening the screen and will continue this conversation with it attached.",
  };
}

export function requireDesktopRun(entry: RunEntry) {
  if (!entry.windowLabel || !entry.agentId) throw notAllowed();
}

export async function runScreenOpen(request: LocalToolRequest, entry: RunEntry) {
  requireDesktopRun(entry);
  const reason = String(request.input.reason ?? "");
  if (!reason.trim()) throw invalidRequest("Describe what the screen is for.");
  const target = typeof request.input.target === "string" ? request.input.target : "";
  let url = typeof request.input.url === "string" ? request.input.url : "";
  if (url && !/^https?:\/\//.test(url))
    throw invalidRequest("url must be an http or https address.");
  if (url) await addressWithoutHost(url);
  const desktop = target === "desktop";
  if (desktop) url = "";
  else {
    const opened = await openInOwnTab(request, entry.runId, url, reason);
    if (opened) return opened;
  }
  if (
    hasDesktopControl(entry) === desktop &&
    entry.contexts.some((item) => contextAllows(item, "browser.act"))
  ) {
    return {
      status: "open",
      screens: screensOf(entry),
      message: "That screen is already attached to this task. Use browser_act with its scopeId.",
    };
  }
  return requestScreen(entry, desktop ? "desktop" : "open", url, reason, target);
}

export async function runScreenLook(request: LocalToolRequest, entry: RunEntry) {
  requireDesktopRun(entry);
  const reason = String(request.input.reason ?? "");
  if (!reason.trim()) throw invalidRequest("Describe what the screen is for.");
  if (entry.captureAttached) {
    return {
      status: "open",
      message:
        "The user's screen is already attached to this request. Read it from the attached image.",
    };
  }
  return requestScreen(entry, "look", "", reason, "");
}

export async function runScreenClose(request: LocalToolRequest, entry: RunEntry) {
  requireDesktopRun(entry);
  const scopeId = String(request.input.scopeId ?? "").trim();
  if (!scopeId) throw invalidRequest("Pass the scopeId of the tab to close.");
  return withRunLock(entry.runId, async () => {
    const current = (await loadRunEntry(entry.runId)) ?? entry;
    const target = sessionTarget(current);
    if (!target) throw invalidRequest("This run has no tabs of its own to close.");
    const own = ownTabs(current, target.deviceId).map((item) => item.opaqueRef);
    const index = own.indexOf(scopeId);
    if (index < 0) {
      throw invalidRequest(`That is not one of your own tabs. Your tabs: ${own.join(", ")}.`);
    }
    if (index === 0) {
      throw invalidRequest(
        "Your first tab stays open; navigate it to a page the person wants instead.",
      );
    }
    const outcome = await settleDeviceJob(
      buildDeviceJob({
        entry: current,
        context: target,
        callId: request.callId,
        node: "browser_close",
        operation: "browser.session",
        input: {
          scopeId: target.opaqueRef,
          conversationId: current.conversationId,
          closeScope: scopeId,
        },
        config: { agentId: current.agentId || "misty-unified" },
        waitMs: browserSessionMs,
      }),
      request.signal,
    );
    if (!outcome.ok) throw deviceOffline(await computerName(), "did not close the tab.");
    await leaveRunTab(entry.runId, scopeId);
    const left = own.filter((item) => item !== scopeId);
    return {
      status: "closed",
      message: `Closed that tab. Your open tabs: ${left.join(", ")}.`,
    };
  });
}
