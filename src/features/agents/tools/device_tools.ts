import { runBrowserTool } from "./browser_tools";
import { runFolderRead, runFolderSend, runShellTool } from "./computer_tools";
import { deviceToolSchemas, matchesSchema } from "./device_tool_schemas";
import {
  LocalToolRejected,
  LocalToolUncertain,
  type LocalToolHandler,
  type LocalToolRequest,
} from "./host";
import { loadRunEntry, type RunEntry } from "./run_contexts";
import { runProgramTool } from "./program_tool";
import { runScreenClose, runScreenLook, runScreenOpen } from "./screen_tools";
import { runTabList, runTabUse } from "./tab_tools";
import { requestUserAction } from "./user_action_wait";

const inputLimit = 256 << 10;
const resultLimit = 6 << 20;

type ToolRun = (request: LocalToolRequest, entry: RunEntry) => Promise<unknown>;

const writes = new Set([
  "browser.navigate",
  "browser.act",
  "browser.upload",
  "browser.steps",
  "browser.skill",
  "browser.fill_form",
  "browser.run",
  "browser.tab.use",
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
  "folder.list": tool("folder.list", runFolderRead),
  "folder.read": tool("folder.read", runFolderRead),
  "folder.send": tool("folder.send", runFolderSend),
  "shell.run": tool("shell.run", runShellTool),
  "screen.open": tool("screen.open", runScreenOpen),
  "screen.look": tool("screen.look", runScreenLook),
  "screen.close": tool("screen.close", runScreenClose),
  "browser.tab.list": tool("browser.tab.list", runTabList),
  "browser.tab.use": tool("browser.tab.use", runTabUse),
};
