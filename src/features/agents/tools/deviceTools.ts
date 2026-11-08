import { runBrowserTool } from "./browserTools";
import {
  runDeviceList,
  runFolderRead,
  runFolderSend,
  runShellTool,
  runWorkspaceTool,
} from "./computerTools";
import { deviceToolSchemas, matchesSchema } from "./deviceToolSchemas";
import {
  LocalToolRejected,
  LocalToolUncertain,
  type LocalToolHandler,
  type LocalToolRequest,
} from "./host";
import { loadRunEntry, type RunEntry } from "./runContexts";
import { runProgramTool } from "./programTool";
import { runScreenClose, runScreenLook, runScreenOpen } from "./screenTools";
import { requestUserAction } from "./userActionWait";

/**
 * Every device tool, run on this computer. Each checks its
 * input as the server's registry does and refuses a run this computer knows nothing about, before the
 * tool's own checks and its job. Plan mode and what stops for the person are decided natively before a
 * call gets here (`tool_policy.rs`).
 */

const inputLimit = 256 << 10;
const resultLimit = 6 << 20;

type ToolRun = (request: LocalToolRequest, entry: RunEntry) => Promise<unknown>;

/** Tools that change something, so a lost result is uncertain. */
const writes = new Set([
  "browser.navigate",
  "browser.act",
  "browser.upload",
  "browser.steps",
  "browser.skill",
  "browser.fill_form",
  "browser.run",
  "browser.tab.open",
  "bookmark.add",
  "folder.send",
  "shell.run",
]);

function tool(name: string, run: ToolRun): LocalToolHandler {
  return async (request) => {
    const input = request.input;
    if (
      JSON.stringify(input).length > inputLimit ||
      !matchesSchema(deviceToolSchemas[name], input)
    ) {
      throw new LocalToolRejected(
        "invalid_arguments",
        "The arguments do not match this tool's input schema.",
      );
    }
    const entry = await loadRunEntry(request.runId);
    if (!entry) {
      throw new LocalToolRejected(
        "run_context_unknown",
        "This computer has no record of what this run may use, so nothing was done. The person can ask again to start a new run.",
      );
    }
    const result = await run({ ...request, name }, entry);
    if (JSON.stringify(result ?? {}).length > resultLimit) {
      if (writes.has(name)) {
        throw new LocalToolUncertain(
          "The action returned no valid result. Its completion is unconfirmed.",
        );
      }
      throw new LocalToolRejected(
        "tool_result_too_large",
        "Misty could not complete this tool call.",
      );
    }
    return result;
  };
}

const browser = (name: string) => tool(name, runBrowserTool);
const workspace = (name: string) => tool(name, runWorkspaceTool);

export const deviceTools: Record<string, LocalToolHandler> = {
  "browser.request_user_action": tool("browser.request_user_action", requestUserAction),
  "browser.workspace.visual": browser("browser.workspace.visual"),
  "browser.inspect": browser("browser.inspect"),
  "browser.visual": browser("browser.visual"),
  "browser.navigate": browser("browser.navigate"),
  "browser.act": browser("browser.act"),
  "browser.upload": browser("browser.upload"),
  "browser.downloads.list": browser("browser.downloads.list"),
  "browser.snapshot": browser("browser.snapshot"),
  "browser.find": browser("browser.find"),
  "browser.extract": browser("browser.extract"),
  "browser.wait_for": browser("browser.wait_for"),
  "browser.steps": browser("browser.steps"),
  "browser.skill": browser("browser.skill"),
  "browser.fill_form": browser("browser.fill_form"),
  "browser.run": tool("browser.run", runProgramTool),
  "browser.tab.list": workspace("browser.tab.list"),
  "browser.tab.open": workspace("browser.tab.open"),
  "bookmark.list": workspace("bookmark.list"),
  "bookmark.add": workspace("bookmark.add"),
  "folder.list": tool("folder.list", runFolderRead),
  "folder.read": tool("folder.read", runFolderRead),
  "folder.send": tool("folder.send", runFolderSend),
  "shell.run": tool("shell.run", runShellTool),
  "screen.open": tool("screen.open", runScreenOpen),
  "screen.look": tool("screen.look", runScreenLook),
  "screen.close": tool("screen.close", runScreenClose),
  "device.list": tool("device.list", runDeviceList),
};
