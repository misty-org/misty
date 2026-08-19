export type ProviderId = "anthropic" | "openai-compat";

export interface AiSettings {
  providerId: ProviderId;
  baseUrl: string;
  model: string;
}

export const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_OPENAI_COMPAT_URL = "https://api.openai.com/v1/chat/completions";

export const DEFAULT_SETTINGS: AiSettings = {
  providerId: "anthropic",
  baseUrl: DEFAULT_ANTHROPIC_URL,
  model: "claude-opus-4-5",
};

export interface RewriteRequest {
  settings: AiSettings;
  apiKey: string;
  instruction: string;
  selection: string;
  language: string;
  filename: string;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
}

export async function streamRewrite(request: RewriteRequest): Promise<void> {
  const systemPrompt = buildSystemPrompt(request.language, request.filename);
  const userPrompt = buildUserPrompt(request.instruction, request.selection);
  if (request.settings.providerId === "anthropic") {
    await streamAnthropic(request, systemPrompt, userPrompt);
  } else {
    await streamOpenAiCompat(request, systemPrompt, userPrompt);
  }
}

function buildSystemPrompt(language: string, filename: string): string {
  return [
    "You are a code editing assistant embedded in Misty Code.",
    `The user is editing ${filename} (${language}).`,
    "Return ONLY the replacement code for the selection. No prose, no markdown fences, no explanations.",
    "Preserve indentation of the surrounding context. Do not include line numbers or diff markers.",
  ].join(" ");
}

function buildUserPrompt(instruction: string, selection: string): string {
  return `Instruction: ${instruction}\n\nCurrent selection:\n${selection}`;
}

async function streamAnthropic(
  request: RewriteRequest,
  system: string,
  user: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-globals
  const response = await fetch(request.settings.baseUrl, {
    method: "POST",
    signal: request.signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.settings.model,
      max_tokens: 4096,
      stream: true,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Anthropic API error (${response.status}): ${text.slice(0, 200)}`);
  }
  await readServerSentEvents(response.body, (event) => {
    if (event.event !== "content_block_delta") return;
    try {
      const data = JSON.parse(event.data);
      const text = data?.delta?.text;
      if (typeof text === "string") request.onDelta(text);
    } catch {
      /* skip malformed event */
    }
  });
}

async function streamOpenAiCompat(
  request: RewriteRequest,
  system: string,
  user: string,
): Promise<void> {
  // eslint-disable-next-line no-restricted-globals
  const response = await fetch(request.settings.baseUrl, {
    method: "POST",
    signal: request.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify({
      model: request.settings.model,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Model API error (${response.status}): ${text.slice(0, 200)}`);
  }
  await readServerSentEvents(response.body, (event) => {
    if (!event.data || event.data === "[DONE]") return;
    try {
      const data = JSON.parse(event.data);
      const text = data?.choices?.[0]?.delta?.content;
      if (typeof text === "string") request.onDelta(text);
    } catch {
      /* skip malformed event */
    }
  });
}

interface ParsedEvent {
  event: string | null;
  data: string;
}

async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const chunk = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        onEvent(parseEvent(chunk));
        index = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(chunk: string): ParsedEvent {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  return { event, data: dataLines.join("\n") };
}
