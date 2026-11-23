import { screenModelOnEngine } from "../engines/misty_calls";

const slot = (prefix: string) => ({
  [`${prefix}_NAME`]: "misty-run-model",
  [`${prefix}_API_KEY`]: "misty-pass-through",
  [`${prefix}_BASE_URL`]: "https://misty.invalid/v1",
  [`${prefix}_PROTOCOL`]: "openai-chat",
  [`${prefix}_RETRY_COUNT`]: 1,
});
export const screenModelConfig = {
  ...slot("MIDSCENE_MODEL"),
  ...slot("MIDSCENE_PLANNING_MODEL"),
};

const maxCalls = 80;

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
