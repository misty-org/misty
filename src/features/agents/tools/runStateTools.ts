import type { AgentChecklist, AgentPlan, AgentPlanPayload } from "../plans/planTypes";
import { LocalToolRejected, type LocalToolHandler } from "./host";
import { askUser } from "./run-state/askUser";
import { checklistResult, saveChecklist, type ChecklistUpdate } from "./run-state/checklistRecords";
import { changeConversationState } from "./run-state/conversationState";
import { notebookKey, readNotebook, writeNotebook } from "./run-state/notebook";
import {
  approvedPlanOf,
  planChecklistSeed,
  proposePlan,
  updatePlanProgress,
  type PlanProgressUpdate,
} from "./run-state/plans";
import {
  checklistSchema,
  notebookReadSchema,
  notebookWriteSchema,
  proposePlanSchema,
  updatePlanSchema,
} from "./run-state/schemas";
import { chatOf, checkedInput, contextOf, correctable, showEvent } from "./run-state/toolSupport";

/**
 * The tools that hold a run's own state on this computer. They change
 * only the chat's own records, never the person's content. Results match the server's word for word:
 * the runtime ends a run on `awaiting_answer` and `plan_proposed`.
 */

const proposePlanTool: LocalToolHandler = async (request) => {
  const payload = checkedInput<AgentPlanPayload>(request, proposePlanSchema);
  const context = await contextOf(request.runId);
  const conversationId = chatOf(context, "This run has no conversation to hold a plan.");
  const plan = await correctable(
    () =>
      changeConversationState(context.account, conversationId, (state) =>
        proposePlan(state, {
          id: `plan_${crypto.randomUUID()}`,
          runId: request.runId,
          author: "agent",
          payload,
          now: Date.now(),
        }),
      ),
    {
      invalid:
        "A plan needs a title, a summary of at most 1,200 characters, and 1-12 steps, each with a " +
        "unique id, an imperative title and a risk of read, write, draft, consequential or dangerous.",
    },
  );
  showEvent(request.runId, context, { type: "plan.proposed", plan });
  return {
    status: "plan_proposed",
    plan: plan.id,
    version: plan.version,
    message:
      "The plan is showing to the user. This run ends here; the user runs it, edits it or asks you to keep planning.",
    user_message: "Review the plan above. Run it, edit it, or keep planning.",
  };
};

const updatePlanTool: LocalToolHandler = async (request) => {
  const { steps } = checkedInput<{ steps: PlanProgressUpdate[] }>(request, updatePlanSchema);
  const context = await contextOf(request.runId);
  const conversationId = chatOf(context, "This conversation has no approved plan in progress.");
  const { plan, checklist } = await correctable(
    () =>
      changeConversationState<{ plan: AgentPlan; checklist?: AgentChecklist }>(
        context.account,
        conversationId,
        (state) => {
          const progress = updatePlanProgress(state, steps, Date.now());
          // plan.update is an alias of the live checklist, seeded from the plan. A step the checklist
          // refuses doesn't undo the progress.
          try {
            const saved = saveChecklist(progress.next, {
              runId: request.runId,
              parentRunId: context.parentRunId,
              seed: planChecklistSeed(approvedPlanOf(progress.next)),
              updates: steps,
              replace: false,
              now: Date.now(),
            });
            return { next: saved.next, result: { plan: progress.result, checklist: saved.result } };
          } catch {
            return { next: progress.next, result: { plan: progress.result } };
          }
        },
      ),
    {
      invalid:
        "Use the approved plan's step ids and one of pending, in_progress, done, skipped or blocked.",
      conflict: "This conversation has no approved plan in progress.",
    },
  );
  showEvent(request.runId, context, { type: "plan.updated", plan });
  if (checklist) showEvent(request.runId, context, { type: "checklist.updated", checklist });
  return {
    status: "recorded",
    plan_state: plan.state,
    remaining: plan.plan.steps
      .filter((step) => !["done", "skipped"].includes(plan.progress[step.id]?.status ?? ""))
      .map((step) => step.id),
  };
};

const checklistTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{ items: ChecklistUpdate[]; replace?: boolean; minutes?: number }>(
    request,
    checklistSchema,
  );
  const context = await contextOf(request.runId);
  const conversationId = chatOf(context, "This run has no conversation to show a checklist in.");
  const checklist = await correctable(
    () =>
      changeConversationState(context.account, conversationId, (state) =>
        saveChecklist(state, {
          runId: request.runId,
          parentRunId: context.parentRunId,
          seed: planChecklistSeed(approvedPlanOf(state)),
          updates: input.items,
          replace: Boolean(input.replace),
          now: Date.now(),
        }),
      ),
    {
      invalid:
        "Each step needs an id, a title when new, and one of pending, in_progress, done, skipped or blocked; at most 20 steps.",
    },
  );
  showEvent(request.runId, context, { type: "checklist.updated", checklist });
  // The estimate goes back with the list: the evals read it.
  return input.minutes
    ? { ...checklistResult(checklist), estimateMinutes: input.minutes }
    : checklistResult(checklist);
};

const notebookReadTool: LocalToolHandler = async (request) => {
  checkedInput(request, notebookReadSchema);
  const context = await contextOf(request.runId);
  const notebook = await readNotebook(context.account, notebookKey(request.runId, context));
  return { plan: notebook.plan, findings: notebook.findings };
};

const notebookWriteTool: LocalToolHandler = async (request) => {
  const input = checkedInput<{
    section: "plan" | "findings";
    content: string;
    mode?: "replace" | "append";
  }>(request, notebookWriteSchema);
  if (!input.content.trim())
    throw new LocalToolRejected(
      "invalid_arguments",
      "The arguments do not match this tool's input schema.",
    );
  const context = await contextOf(request.runId);
  const appending = input.mode === "append" || (!input.mode && input.section === "findings");
  const notebook = await correctable(
    () =>
      writeNotebook(
        context.account,
        notebookKey(request.runId, context),
        input.section,
        input.content,
        appending,
        Date.now(),
      ),
    {},
  );
  // People see the findings; the plan is the agent's own working checklist.
  if (notebook.findings.trim()) publishNotebook(request.runId, context, notebook.findings);
  return {
    saved: true,
    section: input.section,
    chars: new TextEncoder().encode(notebook[input.section]).length,
  };
};

/** A sub-agent's notebook shows in its parent's chat, not its own run. */
function publishNotebook(
  runId: string,
  context: Parameters<typeof showEvent>[1],
  findings: string,
) {
  showEvent(
    context.parentRunId ?? runId,
    { ...context, parentRunId: undefined },
    {
      type: "notebook.updated",
      notebook: { plan: "", findings },
    },
  );
}

export const runStateTools: Record<string, LocalToolHandler> = {
  "conversation.ask_user": askUser,
  "plan.propose": proposePlanTool,
  "plan.update": updatePlanTool,
  "log.work.checklist": checklistTool,
  "log.work.read": notebookReadTool,
  "log.work.write": notebookWriteTool,
};
