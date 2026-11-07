import { invoke } from "@/native/invoke";
import type { AppRequest } from "../apps/api";
import { appRunRequest } from "./appsRun";
import { appsBounded, appsSearchView, mayConnect, searchAppRefusal } from "./appsView";
import {
  LocalToolRejected,
  LocalToolUncertain,
  type LocalToolHandler,
  type LocalToolRequest,
} from "./host";

/**
 * `integration.*` on this computer. Native code holds the Composio
 * key and decides what a call may do; here are the checks on what the model sent, the wait while the
 * person answers a card, and the words the model gets back. With no key native code refuses every call
 * with `apps_not_connected`, saying to use the app's web page.
 */

export interface ActiveAccount {
  app: string;
  account: string;
  alias: string;
  status: string;
}

export interface ComposioSearch {
  found: {
    results: {
      use_case: string;
      execution_guidance: string;
      recommended_plan_steps: string[];
      known_pitfalls: string[];
      primary_tool_slugs: string[];
      related_tool_slugs: string[];
      toolkits: string[];
      error?: string | null;
    }[];
    toolkit_connection_statuses: { toolkit: string }[];
    tool_schemas: Record<
      string,
      { toolkit: string; description: string; input_schema?: unknown; hasFullSchema: boolean }
    >;
  };
  accounts: ActiveAccount[];
}

type Connect = { state: "connected" } | { state: "card"; name: string; request: AppRequest };
type Executed =
  { state: "done"; result: unknown } | { state: "waiting"; title: string; request: AppRequest };

/** One call waits this long for the person, then the run hands off and the card stays. */
const holdMs = 40_000;
const connectCheckMs = 2_000;
const approvalCheckMs = 1_000;

const toolSlug = /^[A-Z][A-Z0-9_]{2,127}$/;
const appSlug = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const argumentsInvalid = "Agent Toolbox arguments do not match the declared schema";

function invalid(message = argumentsInvalid) {
  return new LocalToolRejected("invalid_request", message);
}

function refusal(cause: unknown): Error | undefined {
  const failure = cause as { code?: unknown; message?: unknown; uncertain?: unknown } | null;
  if (typeof failure?.code !== "string" || typeof failure.message !== "string") return undefined;
  return failure.uncertain
    ? new LocalToolUncertain(failure.message)
    : new LocalToolRejected(failure.code, failure.message);
}

/** For calls that change nothing: however one fails, nothing happened. */
async function read<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw (
      refusal(cause) ??
      new LocalToolRejected("apps_unreachable", "Misty couldn't reach this computer's apps.")
    );
  }
}

/** A failure native code didn't explain counts as unknown, which the host reports as uncertain. */
async function execute(args: Record<string, unknown>): Promise<Executed> {
  try {
    return await invoke<Executed>("composio_tool_execute", args);
  } catch (cause) {
    throw refusal(cause) ?? new LocalToolUncertain(String(cause));
  }
}

/** Native code raises the card from what it holds, so a window can't make one up. */
function showCard(runId: string, request: AppRequest) {
  void invoke("composio_request_show", { runId, id: request.id }).catch(() => undefined);
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}

/** Checks the card until the person answers, the hold ends or the run stops waiting. */
async function hold(
  runId: string,
  request: AppRequest,
  every: number,
  signal: AbortSignal,
): Promise<AppRequest> {
  const deadline = Date.now() + holdMs;
  let current = request;
  while (current.state === "pending" && Date.now() + every <= deadline) {
    await pause(every, signal);
    if (signal.aborted) {
      throw new LocalToolRejected("cancelled", "The run stopped waiting for this.");
    }
    current = (
      await read<{ request: AppRequest }>("composio_request_get", { id: current.id, runId })
    ).request;
  }
  return current;
}

const search: LocalToolHandler = async ({ runId, input }) => {
  const { queries } = input;
  if (
    !Array.isArray(queries) ||
    !queries.length ||
    queries.length > 5 ||
    !queries.every((query) => typeof query === "string" && query.length >= 3 && query.length <= 500)
  ) {
    throw invalid();
  }
  const found = await read<ComposioSearch>("composio_tool_search", { runId, queries });
  return appsSearchView(found, await appRunRequest(runId));
};

const schemas: LocalToolHandler = async ({ runId, input }) => {
  const slugs = input.tool_slugs;
  if (
    !Array.isArray(slugs) ||
    !slugs.length ||
    slugs.length > 10 ||
    !slugs.every((slug) => typeof slug === "string" && toolSlug.test(slug))
  ) {
    throw invalid();
  }
  return appsBounded(await read("composio_tool_schemas", { runId, toolSlugs: slugs }));
};

const connected: LocalToolHandler = async ({ runId }) => {
  const items = await read<ActiveAccount[]>("composio_tool_connected", { runId });
  return {
    connected: items.map(({ app, account, alias, status }) => ({ app, account, alias, status })),
  };
};

const connectedResult = (app: string) => ({ app, status: "connected", connected: true });

const connect: LocalToolHandler = async ({ runId, input, signal }) => {
  const app = (typeof input.app === "string" ? input.app : "").trim().toLowerCase();
  if (!appSlug.test(app)) {
    throw invalid("app must be an app slug from integration_search, such as googledrive");
  }
  if (!mayConnect(app, await appRunRequest(runId))) {
    const accounts = await read<ActiveAccount[]>("composio_tool_connected", { runId });
    if (accounts.some((item) => item.app === app)) return connectedResult(app);
    throw invalid(searchAppRefusal(app));
  }
  const opened = await read<Connect>("composio_tool_connect", { runId, subject: app });
  if (opened.state === "connected") return connectedResult(app);
  const { name, request } = opened;
  const dismissed = () =>
    invalid(
      `The user dismissed using ${name} here. Continue without it, or ask what they would prefer.`,
    );
  if (request.state === "declined") throw dismissed();
  showCard(runId, request);
  const answered = await hold(runId, request, connectCheckMs, signal);
  if (answered.state === "connected") {
    showCard(runId, answered);
    return connectedResult(app);
  }
  if (answered.state === "declined") throw dismissed();
  return {
    app,
    status: "waiting_for_user",
    message: `A ${request.title} card is showing in the chat. This run ends here and Misty continues once the user connects ${name}.`,
    user_message: `${request.summary} Use the card above; Misty continues once it's done.`,
  };
};

const run: LocalToolHandler = async ({ runId, input, signal }: LocalToolRequest) => {
  const slug = input.tool_slug;
  if (typeof slug !== "string" || !toolSlug.test(slug)) {
    throw invalid(
      "tool_slug must be an exact slug from integration_search, such as GMAIL_SEND_EMAIL",
    );
  }
  const given = input.arguments ?? {};
  if (typeof given !== "object" || Array.isArray(given)) throw invalid();
  const account = input.account ?? "";
  if (typeof account !== "string" || account.length > 160) throw invalid();
  const call = {
    runId,
    toolSlug: slug,
    arguments: given,
    account: account.trim(),
  };
  const first = await execute(call);
  if (first.state === "done") return first.result;
  const { title, request } = first;
  if (request.state === "pending") showCard(runId, request);
  const answered = await hold(runId, request, approvalCheckMs, signal);
  switch (answered.state) {
    case "pending":
      break;
    case "approved": {
      showCard(runId, answered);
      // Native code uses the approval up here, and only for these same arguments.
      const second = await execute(call);
      if (second.state === "done") return second.result;
      break;
    }
    case "declined":
      showCard(runId, answered);
      throw new LocalToolRejected(
        "declined",
        `The user declined “${title}”. Do not retry it; continue without it or ask the user.`,
      );
    default:
      throw new LocalToolRejected(
        "expired",
        `The approval request for “${title}” expired without an answer, which counts as declined. Call the tool again to ask the user again.`,
      );
  }
  return {
    status: "awaiting_approval",
    request: request.id,
    message: `An approval card for “${title}” is showing in the chat. This run ends here and continues after the user decides.`,
    user_message: `“${title}” is waiting for your approval above.`,
  };
};

export const appsTools: Record<string, LocalToolHandler> = {
  "integration.search": search,
  "integration.schemas": schemas,
  "integration.connected": connected,
  "integration.connect": connect,
  "integration.execute": run,
};
