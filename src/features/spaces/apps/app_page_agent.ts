import type { ScreenChannel } from "./app_screen";

export interface PageAgentLink {
  agent(operation: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
  input(action: Record<string, unknown>, viewport: unknown, editable: boolean): Promise<unknown>;
  steps(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  history(direction: string): Promise<Record<string, unknown>>;
  picture(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  emulate(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  pdf(runId: string, path: string): Promise<Record<string, unknown>>;
  onPoint(listener: (spot: [number, number]) => void): () => void;
}

export interface AppStep {
  action: string;
  ref?: string;
  text?: string;
  submit?: boolean;
  values?: string[];
  key?: string;
  modifiers?: string[];
  direction?: string;
  amount?: number;
  clickCount?: number;
  button?: string;
  textGone?: string;
  timeoutMs?: number;
  x?: number;
  y?: number;
  to?: string;
  toX?: number;
  toY?: number;
  deltaX?: number;
  deltaY?: number;
  slowly?: boolean;
  url?: string;
}

export const STEP_ACTIONS = [
  "click",
  "type",
  "fill",
  "select",
  "check",
  "uncheck",
  "key",
  "hover",
  "scroll",
  "wait_for",
  "click_at",
  "move_to",
  "mouse_down",
  "mouse_up",
  "wheel",
  "drag",
  "key_down",
  "key_up",
  "drop",
] as const;

export const MAX_STEPS = 10;
export const MAX_FIELDS = 30;
const READ_CHARS = 16_000;
const AFTER_CHARS = 4_000;

export const screenWords = (text: string) =>
  text
    .replace(/browser_snapshot/g, "screen_read")
    .replace(/browser_find/g, "screen_read")
    .replace(/browser_steps/g, "screen_steps")
    .replace(/browser_upload/g, "screen_upload")
    .replace(/browser_request_user_action/g, "the chat");

const said = (value: unknown) => (typeof value === "string" ? screenWords(value) : value);

const saidAll = <T>(value: T): T => JSON.parse(screenWords(JSON.stringify(value))) as T;

export class PageStepError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

const objectOf = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export function createAppPage(options: {
  link: PageAgentLink;
  screen: ScreenChannel;
  appName: string;
  pointTo(spot: [number, number]): Promise<void>;
}) {
  const { link, screen, appName } = options;
  let documentId: string | null = null;

  const call = async (operation: string, args: Record<string, unknown> = {}) =>
    link.agent(operation, args);
  const candidate = () => crypto.randomUUID();
  const extras = async () => {
    const state = await screen
      .command<{ fileChooser?: boolean; dialog?: unknown }>("state")
      .catch(() => null);
    return {
      ...(state?.fileChooser ? { fileChooser: true } : {}),
      ...(state?.dialog ? { dialog: state.dialog } : {}),
    };
  };

  const read = async () => {
    const result = await call("snapshot", {
      candidateId: candidate(),
      maxChars: READ_CHARS,
      maxRefs: 600,
    });
    if (result.ok !== true)
      throw new PageStepError(
        String(said(result.error) ?? `${appName} couldn't be read.`),
        "app_screen_failed",
      );
    documentId = typeof result.documentId === "string" ? result.documentId : null;
    return {
      title: result.title,
      tree: said(result.tree),
      truncated: result.truncated,
      dialogs: result.dialogs,
      focused: result.focused,
      scroll: result.scroll,
      ...(await extras()),
    };
  };

  const ensureDocument = async (needsRefs: boolean) => {
    const seen = await call("observe").catch(() => null);
    const current =
      typeof seen?.documentId === "string" && seen.documentId ? seen.documentId : null;
    if (current && (current === documentId || !needsRefs)) {
      documentId = current;
      return current;
    }
    if (needsRefs)
      throw new PageStepError(
        documentId
          ? `${appName} changed since you read it. Read it again with screen_read for fresh refs.`
          : `Read ${appName} with screen_read first, then act on its refs.`,
        "app_screen_stale",
      );
    const fresh = await call("compact", { candidateId: candidate(), maxChars: 1_000 });
    documentId = typeof fresh.documentId === "string" ? fresh.documentId : null;
    if (!documentId) throw new PageStepError(`${appName} couldn't be read.`, "app_screen_failed");
    return documentId;
  };

  const steps = async (input: {
    steps?: AppStep[];
    fields?: unknown[];
    allowConsequential?: boolean;
  }) => {
    const needsRefs =
      Array.isArray(input.fields) ||
      (input.steps ?? []).some((step) => typeof objectOf(step)?.ref === "string");
    const document = await ensureDocument(needsRefs);
    await screen.command("hold", { on: true }).catch(() => undefined);
    const stopPointing = link.onPoint((spot) => void options.pointTo(spot));
    let result: Record<string, unknown>;
    try {
      result = await link.steps({
        ...(input.fields ? { fields: input.fields } : { steps: input.steps ?? [] }),
        documentId: document,
        allowConsequential: input.allowConsequential === true,
        includeSnapshot: true,
      });
    } finally {
      stopPointing();
      await screen.command("hold", { on: false }).catch(() => undefined);
    }
    const after = objectOf(result.snapshot);
    if (typeof after?.documentId === "string") documentId = after.documentId;
    const answer: Record<string, unknown> = { ...result };
    delete answer.snapshot;
    return saidAll<Record<string, unknown>>({
      ...answer,
      ...(after ? { now: after.tree, truncated: after.truncated } : {}),
      ...(await extras()),
    });
  };

  const report = async () => {
    const after = await call("compact", {
      candidateId: candidate(),
      maxChars: AFTER_CHARS,
      maxRefs: 800,
    }).catch(() => null);
    if (typeof after?.documentId === "string") documentId = after.documentId;
    return {
      ...(after?.ok === true ? { now: said(after.tree), truncated: after.truncated } : {}),
      ...(await extras()),
    };
  };

  const pointOf = async (ref: string) => {
    const document = await ensureDocument(true);
    const prepared = await call("prepare", { documentId: document, ref, action: "hover" });
    const point = prepared.point as { x?: number; y?: number } | null | undefined;
    if (
      prepared.ok !== true ||
      !point ||
      typeof point.x !== "number" ||
      typeof point.y !== "number"
    )
      throw new PageStepError(
        String(said(prepared.error) ?? `Misty can't reach ${ref} in ${appName}.`),
        "app_screen_failed",
      );
    return [point.x, point.y] as [number, number];
  };

  const nativeAt = async (action: Record<string, unknown>) => {
    const document = await ensureDocument(false);
    const prepared = await call("prepare", { documentId: document, action: "key" });
    await screen.command("hold", { on: true }).catch(() => undefined);
    try {
      await link.input(action, prepared.viewport, prepared.editable === true);
      return true;
    } catch {
      return false;
    } finally {
      await screen.command("hold", { on: false }).catch(() => undefined);
    }
  };

  const currentDocument = () => ensureDocument(false);

  return { read, steps, report, pointOf, nativeAt, currentDocument };
}

export type AppPage = ReturnType<typeof createAppPage>;
