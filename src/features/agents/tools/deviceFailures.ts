import { deviceJobFailure } from "../runs/jobs/workerJobOutcome";
import { LocalToolRejected, LocalToolUncertain } from "./host";

/**
 * What the model reads when a device tool fails, in the server's words (`browserDeviceFailure`,
 * `awaitBrowserDeviceJob`, `deviceToolFailure` and `mcpToolError` in misty-server), so moving a tool
 * to this computer doesn't change how an agent recovers.
 */

const observationReads = new Set([
  "browser.inspect",
  "browser.visual",
  "browser.downloads.list",
  "browser.workspace.visual",
  "browser.snapshot",
  "browser.find",
  "browser.extract",
  "browser.wait_for",
]);

/** Observations have no effect, so an interrupted one can be retried and is never uncertain. */
export const browserObservation = (operation: string) => observationReads.has(operation);

export const notAllowed = () =>
  new LocalToolRejected("tool_not_allowed", "This tool call is not allowed for the current run.");

export const argumentsInvalid = () =>
  new LocalToolRejected("invalid_arguments", "The tool arguments are invalid.");

export const invalidRequest = (message: string) =>
  new LocalToolRejected("invalid_request", message.slice(0, 500));

export const observationFailed = () =>
  new LocalToolRejected(
    "browser_observation_failed",
    "browser_observation_failed: The page could not be observed; the agent window may be paused " +
      "or closed. Observe it again once; if that also fails, report the browser problem.",
  );

const actionUnknown = "The action may have completed. Reconcile its outcome before retrying.";

/** A failure that ends the run: the person acts on it, as `deviceOfflineError` says. */
export const deviceOffline = (name: string, reason: string) =>
  new LocalToolRejected(
    "device_offline",
    `device_offline: ${name} ${reason} Ask again once Misty is open there.`,
  );

const hints: Record<string, string> = {
  browser_timeout:
    "The page did not answer in time. Read it again, or wait for it (waitFor) before acting.",
  browser_tab_closed: "That tab is closed. List your tabs, or open the page again.",
  agent_tab_closed: "That tab is closed. List your tabs, or open the page again.",
  browser_grant_invalid:
    "This run may no longer act in that tab. Open the page in a new tab of your own.",
  invalid_scope: "That scopeId is not one of your tabs. Use one from your list of tabs.",
  browser_snapshot_stale: "The page changed since it was read. Read it again and use the new refs.",
  destination_unreachable: "The site did not answer. Check the address, or search for the site.",
  destination_refused:
    "The site refused the connection. Try another page of the site or another source.",
  fetch_failed: "The page could not be fetched. Open it in a tab of your own instead.",
  fetch_timeout: "The page took too long to fetch. Open it in a tab of your own instead.",
  unsupported_content:
    "That kind of file cannot be read here. Find an HTML page with the same information.",
  device_execution_failed:
    "The step failed on the device. Read the page and try another way to reach the same control.",
  browser_text_not_kept:
    "The editor did not keep the text. Type it with real keystrokes, in parts if it is long.",
  device_execution_expired: "The step ran out of time on the device. Try a smaller step.",
};

export const deviceFailureMessage = (code: string) =>
  `${code}: ${hints[code] ?? "Read the page again and try another way."}`;

function browserFailureMessage(code: string, operation: string) {
  switch (code) {
    case "browser_snapshot_stale":
      return operation.startsWith("browser.workspace.")
        ? "The screenshot was consumed or became stale. No input was dispatched. Call browser_workspace_visual " +
            "to capture the current control surface, then decide the next action with its new documentId. " +
            "Capture again after every action, including clicking before typing."
        : "The page changed since it was read. No action was dispatched. Read it again with browser_snapshot " +
            "(or browser_inspect, if that is what you used) and use its new references before deciding " +
            "the next action.";
    case "browser_webview_unavailable":
      return (
        "browser_webview_unavailable: This tab has no page that can be read or used; its address " +
        "may not exist or failed to load. Nothing was done. Navigate the tab to an address that works " +
        "(search for the site if unsure), or close it and open another tab."
      );
    case "desktop_accessibility_required":
      return "desktop_accessibility_required: Allow the running Misty app in System Settings → Privacy & Security → Accessibility, then retry.";
    case "desktop_screen_recording_required":
      return "desktop_screen_recording_required: Allow the running Misty app in System Settings → Privacy & Security → Screen Recording, then retry.";
    default:
      return deviceFailureMessage(code);
  }
}

/**
 * A page tool's failure. `stopped` means its time ran out or its run stopped, so nobody saw how it
 * ended: that's uncertain for an action and a failed look for an observation.
 */
export function browserToolFailure(operation: string, error: unknown, stopped = false): Error {
  const { uncertain, errorCode } = deviceJobFailure(operation, error, true);
  if (browserObservation(operation)) {
    return uncertain || stopped
      ? observationFailed()
      : new LocalToolRejected(errorCode, browserFailureMessage(errorCode, operation));
  }
  if (uncertain) return new LocalToolUncertain(actionUnknown);
  return new LocalToolRejected(errorCode, browserFailureMessage(errorCode, operation));
}

const computerMessages: Record<string, string> = {
  invalid_scope: "that path is outside the shared folder",
  unsupported_content: "that file or page is not readable text",
  device_unavailable: "the user's computer is offline",
  device_timeout: "the user's computer did not answer in time",
  invalid_url: "use an http or https address",
  workspace_unavailable: "the Misty browser is not open on the user's computer",
  device_grant_invalid: "the user's computer could not confirm this request",
};

const computerMessage = (code: string) =>
  computerMessages[code] ?? `the user's computer could not do that (${code})`;

const computerReads = new Set(["folder.list", "folder.read", "browser.tab.list", "bookmark.list"]);

/** A folder, tab list, bookmark or shell tool's failure (`runDeviceTool`). */
export function computerToolFailure(name: string, error: unknown, stopped = false): Error {
  const { uncertain, errorCode } = deviceJobFailure(name, error, true);
  if (computerReads.has(name)) {
    const code = stopped ? "device_timeout" : errorCode.split(":").pop() || errorCode;
    return new LocalToolRejected(code, computerMessage(code));
  }
  if (uncertain || stopped) return new LocalToolUncertain(actionUnknown);
  return new LocalToolRejected(errorCode, computerMessage(errorCode));
}
