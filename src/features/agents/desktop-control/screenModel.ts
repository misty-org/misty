import { screenModelOnEngine } from "../engines/mistyCalls";

// Midscene resolves these like environment variables. A separate planning
// slot keeps planning free of element-locating calls: actions carry their own
// coordinates, so any vision model the run chose can plan.
const slot = (prefix: string) => ({
  [`${prefix}_NAME`]: "misty-run-model",
  [`${prefix}_API_KEY`]: "misty-pass-through",
  // Required by Midscene's config check; screenModelClient answers every call,
  // so nothing is ever sent here.
  [`${prefix}_BASE_URL`]: "https://misty.invalid/v1",
  [`${prefix}_PROTOCOL`]: "openai-chat",
  [`${prefix}_RETRY_COUNT`]: 1,
});
export const screenModelConfig = {
  ...slot("MIDSCENE_MODEL"),
  ...slot("MIDSCENE_PLANNING_MODEL"),
};

// One act job runs a whole goal for up to four minutes, waiting between moves without model
// calls; this caps runaway planners, not normal play.
const maxCalls = 80;

/**
 * An OpenAI-style client whose every completion is one run on the default engine, which sees the
 * screenshots. Misty has no model of its own.
 */
export function screenModelClient() {
  let call = 0;
  const client = {
    chat: {
      completions: {
        create: async (
          request: { messages: unknown[]; stream?: boolean },
          options?: { signal?: AbortSignal },
        ) => {
          if (call >= maxCalls) throw new Error("This screen task used all of its model calls.");
          call++;
          const response = await screenModelOnEngine(
            request.messages as Parameters<typeof screenModelOnEngine>[0],
            options?.signal,
          );
          if (!request.stream) return response;
          const text = response.choices[0]?.message.content ?? "";
          return (async function* () {
            yield {
              model: response.model,
              choices: [{ delta: { content: text } }],
            };
          })();
        },
      },
    },
  };
  return {
    calls: () => call,
    createOpenAIClient: async () => client,
  };
}
