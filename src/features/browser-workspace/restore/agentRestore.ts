import { apiRequest } from "@/api/client";
import { RESTORE_LIMITS } from "./budget";
import { guardPage, pageAct, pageControls, type RestoreAction, type RestoreReport } from "./native";

export type AgentOutcome = "done" | "user" | "budget" | "failed";

/**
 * Asks the server for one restricted action at a time and runs it in the
 * page. Only unplaced `normal` fields are sent. The page is guarded against
 * submission throughout, and any real user input ends the run for that tab.
 */
export async function agentRestore(
  runtimeId: string,
  report: RestoreReport,
  stillCurrent: () => boolean,
): Promise<AgentOutcome> {
  const restoreId = crypto.randomUUID();
  const goal = report.agent_fields.map(({ label, kind, value }) => ({ label, kind, value }));
  const history: { action: string; result: string }[] = [];
  const baseline = await guardPage(runtimeId, true);
  try {
    for (let step = 0; step < RESTORE_LIMITS.stepsPerTab; step++) {
      if (!stillCurrent()) return "failed";
      const controls = await pageControls(runtimeId);
      const { action } = await apiRequest<{ action: RestoreAction }>("/sync/restore/step", {
        method: "POST",
        body: JSON.stringify({
          restore_id: restoreId,
          step,
          url: report.url,
          goal,
          controls,
          history,
        }),
      });
      if (action.type === "done") return "done";
      // User input wins: stop before acting if they touched the page.
      if ((await guardPage(runtimeId, true)) > baseline) return "user";
      const result = await pageAct(runtimeId, action);
      history.push({
        action: JSON.stringify({ type: action.type, ref: action.ref }),
        result: result.ok ? "ok" : (result.error ?? "failed"),
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return "budget";
  } catch {
    return "failed";
  } finally {
    await guardPage(runtimeId, false).catch(() => 0);
  }
}
