// Odysseys' per-rubric judge, ported from scripts/python/run_full_trajectory_per_rubric.py
// (MIT, see data/NOTICE): the same system prompt and message, one call per rubric item,
// the trajectory's action history and every screenshot in order, and the same
// success/failure parse. A rubric scores 1 when the trajectory satisfies it; a task is
// perfect when every rubric does. Differences from the official runs are only the judge
// model (MISTY_ODYSSEYS_JUDGE_MODEL) and a cap of 60 pictures (the recorder skips unchanged
// ones, so long runs rarely reach it). Changing the prompt, the message or the parse makes
// every recorded baseline incomparable; test/judge.test.ts holds them still.
import { askJudge, type JudgeReply } from "./judge-request.ts";
import type { JudgeConfig } from "./judge-config.ts";
import type { Step } from "./recorder.ts";
import type { OdysseysTask } from "./tasks.ts";

export const system = `You are an expert evaluator of web-navigation agent trajectories.

You will receive:
- The user task (for context).
- ONE specific rubric item with a requirement and a verification description.
- The agent's full action history (one line per step).
- Every screenshot from the trajectory, in chronological order.

Your goal is to decide whether this single rubric item is satisfied by the trajectory.

Evaluation rules:
- Judge ONLY the one rubric item you are given; ignore all other implicit requirements.
- Ground your judgment in what the screenshots and actions actually show. Do not invent state.
- Filtering / sorting / form requirements must be applied and confirmed to count as satisfied.
- If the agent was blocked (captcha, access denied, etc.) and therefore could not satisfy the rubric, report failure.

Respond in exactly this format:

Thoughts: <your reasoning, citing specific steps/screenshots>
Status: "success" or "failure"
`;

export interface RubricResult {
  id: string;
  success: boolean;
  reasoning: string;
  /** The judge gave no verdict (an outage, or no "Status:" line): says nothing about the run. */
  judgeError?: boolean;
}

export interface TaskVerdict {
  rubrics: RubricResult[];
  average: number;
  perfect: boolean;
  inputTokens: number;
  outputTokens: number;
}

export interface JudgeOptions {
  maxImages: number;
  lanes: number;
  /** How long one call may stay silent before it's asked again. */
  quietMs?: number;
  /** Waits between tries; tests don't. */
  wait?: (ms: number) => Promise<void>;
}

export function actionHistory(steps: Step[]): string {
  return steps.map((step, index) => {
    const parts = [step.response.trim() ? `Response: ${step.response.trim()}` : "", step.action ? `Action: ${step.action}` : ""].filter(Boolean);
    return parts.length ? `${index + 1}. ${parts.join("\n")}` : "";
  }).filter(Boolean).join("\n") || "No actions recorded.";
}

export function rubricMessage(task: OdysseysTask, rubric: OdysseysTask["rubrics"][number], history: string, imageCount: number, stepCount: number): string {
  const lines = [`Rubric ID: ${rubric.id}`, `Requirement: ${rubric.requirement.trim()}`, ...(rubric.verification.trim() ? [`Verification: ${rubric.verification.trim()}`] : [])];
  return `User Task (context only): ${task.prompt.trim()}\n\nEvaluate ONLY this rubric item:\n${lines.join("\n")}` +
    `\n\nFull Action History:\n${history}\n\nScreenshots attached below: ${imageCount} (trajectory had ${stepCount} total step(s)).` +
    `\n\nDecide whether the rubric (${rubric.id}) is satisfied. Use the required 'Thoughts:' / 'Status:' format.`;
}

/** A reply's verdict. A reply with no "Status:" line is no verdict at all, not a failed rubric. */
export function parseVerdict(text: string): { verdict: boolean; success: boolean; reasoning: string } {
  const status = /Status:\s*["']?(success|failure)["']?/i.exec(text);
  const thoughts = /Thoughts:\s*([\s\S]+?)(?:Status:|$)/.exec(text);
  return { verdict: Boolean(status), success: status?.[1]?.toLowerCase() === "success", reasoning: (thoughts?.[1] ?? text).trim().slice(0, 1_200) };
}

const retryable = /judge_quiet|429|rate.?limit|quota|exhaust|overload|unavailable|50\d|fetch failed/i;

/** Grades every rubric of one task; the last `maxImages` screenshots go to each call. */
export async function judgeTask(judge: JudgeConfig, task: OdysseysTask, steps: Step[], screenshots: string[], options: JudgeOptions): Promise<TaskVerdict> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const history = actionHistory(steps);
  const images = screenshots.slice(-options.maxImages);
  let inputTokens = 0;
  let outputTokens = 0;
  const judgeOne = async (rubric: OdysseysTask["rubrics"][number]): Promise<RubricResult> => {
    const input = { system, text: rubricMessage(task, rubric, history, images.length, steps.length), images, maxOutputTokens: 16_000 };
    try {
      let result: JudgeReply | undefined;
      // A reply with no verdict is asked again, twice at most.
      for (let attempt = 0; !result || (!parseVerdict(result.text).verdict && attempt < 3); attempt++) {
        if (result) {
          inputTokens += result.inputTokens;
          outputTokens += result.outputTokens;
        }
        result = await askJudge(judge, input, options.quietMs ?? 300_000).catch(async (error: unknown) => {
          // A quiet call, a rate limit or a provider error says nothing about the run: wait
          // longer each time and ask again, rather than grading the agent on the judge's outage.
          if (attempt < 5 && retryable.test(String(error))) {
            await wait(30_000 * (attempt + 1));
            return undefined;
          }
          throw error;
        });
      }
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      const parsed = parseVerdict(result.text);
      return { id: rubric.id, success: parsed.success, reasoning: parsed.reasoning, ...(parsed.verdict ? {} : { judgeError: true }) };
    } catch (error) {
      return { id: rubric.id, success: false, reasoning: `Error judging rubric ${rubric.id}: ${String(error).slice(0, 300)}`, judgeError: true };
    }
  };
  // Each rubric item is judged on its own, as the original does, a few at a time so a rate limit
  // isn't graded as a failed rubric.
  const rubrics: RubricResult[] = new Array(task.rubrics.length);
  let next = 0;
  const lane = async () => {
    while (next < task.rubrics.length) {
      const index = next++;
      rubrics[index] = await judgeOne(task.rubrics[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.lanes) }, lane));
  const passed = rubrics.filter((item) => item.success).length;
  return { rubrics, average: rubrics.length ? passed / rubrics.length : 0, perfect: rubrics.length > 0 && passed === rubrics.length, inputTokens, outputTokens };
}
