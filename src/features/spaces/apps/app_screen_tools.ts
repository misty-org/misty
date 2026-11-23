import { invoke } from "@tauri-apps/api/core";
import { LocalToolRejected, loadRunEntry, usePersonalAgentsStore } from "@/features/agents";
import type { LocalToolHandler } from "@/features/agents";
import type { ScreenChannel } from "./app_screen";
import { useAppControl } from "./app_screen";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
}

const point = {
  x: {
    type: "number",
    minimum: 0,
    maximum: 1,
    description: "From the app's left edge (0) to its right (1).",
  },
  y: {
    type: "number",
    minimum: 0,
    maximum: 1,
    description: "From the app's top edge (0) to its bottom (1).",
  },
};

const fraction = (value: unknown, what: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new LocalToolRejected("invalid_request", `${what} must be a number from 0 to 1.`);
  return value;
};

export function createScreenTools(options: {
  appId: string;
  appName: string;
  screen: ScreenChannel;
  frame(): HTMLElement | null;
  snapshot?: () => Promise<{ dataUrl: string; width: number; height: number }>;
}) {
  const { appId, appName, screen } = options;
  const definitions: ToolDefinition[] = [
    {
      name: "screen_read",
      description:
        `Read what ${appName} shows now: its title, its text and its controls, each with where it ` +
        `is (fractions of the app's view). An app drawn on a canvas has little text; picture it ` +
        `with screen_look.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "screen_look",
      description: `A picture of ${appName} as the person sees it now.`,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "screen_click",
      description: `Click in ${appName} at a point, as the person would. Your pointer shows there in their window.`,
      inputSchema: {
        type: "object",
        properties: { ...point, double: { type: "boolean", description: "A double click." } },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
    {
      name: "screen_type",
      description: `Type text into what has focus in ${appName}. Click a field first.`,
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", maxLength: 4000 } },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: "screen_key",
      description: `Press one key in ${appName}, such as Enter, Escape, ArrowDown or a letter with modifiers.`,
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", maxLength: 32 },
          ctrl: { type: "boolean" },
          shift: { type: "boolean" },
          alt: { type: "boolean" },
          meta: { type: "boolean" },
        },
        required: ["key"],
        additionalProperties: false,
      },
    },
    {
      name: "screen_scroll",
      description: `Scroll ${appName} at a point. dy is how far, as a fraction of the view (negative goes up).`,
      inputSchema: {
        type: "object",
        properties: { ...point, dy: { type: "number", minimum: -5, maximum: 5 } },
        required: ["x", "y", "dy"],
        additionalProperties: false,
      },
    },
  ];

  const agentOf = async (runId: string) => {
    const entry = await loadRunEntry(runId).catch(() => null);
    const agentId = entry?.agentId ?? runId;
    const agent = usePersonalAgentsStore
      .getState()
      .agents.find((candidate) => candidate.id === agentId);
    return { agentId, name: agent?.name || "Agent" };
  };
  const inControl = () => {
    if (useAppControl.getState().held[appId])
      throw new LocalToolRejected(
        "person_has_control",
        `The person is using ${appName} now and took control back. Wait for them to hand it back, or ask them in the chat.`,
      );
  };
  const acting =
    (
      run: (input: Record<string, unknown>) => Promise<unknown>,
      at?: (input: Record<string, unknown>) => [number, number],
    ) =>
    async (input: Record<string, unknown>, runId: string) => {
      inControl();
      if (at) {
        const [x, y] = at(input);
        const agent = await agentOf(runId);
        useAppControl.getState().point(appId, { ...agent, x, y });
      }
      try {
        return await run(input);
      } catch (error) {
        if (error instanceof LocalToolRejected) throw error;
        throw new LocalToolRejected(
          "app_screen_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    };
  const pointAt = (input: Record<string, unknown>): [number, number] => [
    fraction(input.x, "x"),
    fraction(input.y, "y"),
  ];

  const look = async () => {
    if (options.snapshot) {
      try {
        return { image: await options.snapshot() };
      } catch {}
    }
    const frame = options.frame();
    if (frame) {
      const box = frame.getBoundingClientRect();
      try {
        const image = await invoke<{ dataUrl: string; width: number; height: number }>(
          "space_app_snapshot",
          {
            x: box.left,
            y: box.top,
            width: box.width,
            height: box.height,
          },
        );
        return { image };
      } catch {}
    }
    const drawn = await screen.command<{ dataUrl: string | null }>("look");
    if (!drawn.dataUrl)
      throw new Error(`Misty can't picture ${appName} here. Read it with screen_read instead.`);
    return { image: { dataUrl: drawn.dataUrl } };
  };

  const run: Record<string, (input: Record<string, unknown>, runId: string) => Promise<unknown>> = {
    screen_read: acting(() => screen.command("read")),
    screen_look: acting(look),
    screen_click: acting(
      (input) => screen.command("click", { x: input.x, y: input.y, double: input.double === true }),
      pointAt,
    ),
    screen_type: acting((input) => {
      if (typeof input.text !== "string")
        throw new LocalToolRejected("invalid_request", "text is required.");
      return screen.command("type", { text: input.text });
    }),
    screen_key: acting((input) => {
      if (typeof input.key !== "string" || !input.key)
        throw new LocalToolRejected("invalid_request", "key is required.");
      return screen.command("key", input);
    }),
    screen_scroll: acting((input) => screen.command("scroll", input), pointAt),
  };

  const handlers = (name: (tool: string) => string): Record<string, LocalToolHandler> =>
    Object.fromEntries(
      definitions.map((definition) => [
        name(definition.name),
        (request) => run[definition.name](request.input, request.runId),
      ]),
    );
  return { definitions, handlers };
}
