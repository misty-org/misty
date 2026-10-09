import { apiRequest } from "@/api/client";

type Completion = {
  model?: string;
  choices: Array<{ message: { role: string; content: string } }>;
  usage?: Record<string, number>;
};

// Midscene resolves these like environment variables. A separate planning
// slot keeps planning free of element-locating calls: actions carry their own
// coordinates, so any vision model the run chose can plan.
const slot = (prefix: string) => ({
  [`${prefix}_NAME`]: "misty-run-model",
  [`${prefix}_API_KEY`]: "misty-pass-through",
  [`${prefix}_PROTOCOL`]: "openai-chat",
  [`${prefix}_RETRY_COUNT`]: 1,
});
export const screenModelConfig = {
  ...slot("MIDSCENE_MODEL"),
  ...slot("MIDSCENE_PLANNING_MODEL"),
};

/**
 * An OpenAI-style client whose every completion is one numbered call to
 * Misty's metered pass-through for this act job. The server admits, meters
 * and caps each call, and the desktop never holds a model key.
 */
export function screenModelClient(jobId: string) {
  let call = 0;
  const client = {
    chat: {
      completions: {
        create: async (
          request: { messages: unknown[]; stream?: boolean },
          options?: { signal?: AbortSignal },
        ) => {
          const response = await apiRequest<Completion>(
            `/me/screen-model/${encodeURIComponent(jobId)}?call=${call++}`,
            {
              method: "POST",
              body: JSON.stringify({ messages: request.messages }),
              signal: options?.signal,
            },
          );
          if (!request.stream) return response;
          const text = response.choices[0]?.message.content ?? "";
          return (async function* () {
            yield {
              model: response.model,
              choices: [{ delta: { content: text } }],
              usage: response.usage,
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
