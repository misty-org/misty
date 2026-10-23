import { browserTabAgentFileCapabilities } from "../browserTabCapabilities";
import { executeBrowserJob } from "../browserJobRun";
import { agentTab, agentTabsForTask, keepAgentTab } from "../agentTabs";
import type { ClaimedWorkflowNodeJob } from "../workerBrowserJobs";
import { unwrapSearchRedirect } from "./searchRedirect";

/**
 * What a browser_run program's page calls do (programs/prelude.ts): each is one browser operation
 * on one of this task's own tabs, run the way a device job runs it (browserJobRun.ts), with its
 * own grant and the job's lease. The host remembers each tab's document, so targets are a ref,
 * a locator or words, never an id the model copies.
 */
type Job = ClaimedWorkflowNodeJob["job"];

export interface ProgramState {
  job: Job;
  taskId: () => string;
  signal: AbortSignal;
  /** The job's lease now: the worker renews it while the program runs. */
  lease: () => string | null | undefined;
  /** Opens a tab of the agent's own and returns its scope (the hosted session's code). */
  openTab: (url: string) => Promise<string>;
  calls: number;
  notes: unknown[];
  kept: Set<string>;
  documents: Map<string, string>;
}

const MAX_CALLS = 80;
const ref = /\[ref=(e\d+)\]/;
const clip = (text: unknown, limit: number) =>
  typeof text === "string" && text.length > limit ? `${text.slice(0, limit)}…` : text;

export function pageHost(state: ProgramState) {
  const ownTab = (scope: unknown): string => {
    const id = String(scope ?? "");
    const tab = agentTab(id);
    if (!tab || tab.taskId !== state.taskId())
      throw new Error(`No tab of yours is ${id || "named"}. Use tabs() or open(url).`);
    return id;
  };
  const operate = async (operation: string, scopeId: string, input: Record<string, unknown>) => {
    if (++state.calls > MAX_CALLS)
      throw new Error(
        `A program makes at most ${MAX_CALLS} page calls. Return what you have and continue in another.`,
      );
    state.signal.throwIfAborted();
    const config = {
      ...((state.job.config ?? {}) as Record<string, unknown>),
      taskId: state.taskId(),
      contextCapabilities: browserTabAgentFileCapabilities,
    };
    const output = await executeBrowserJob(
      {
        ...state.job,
        id: `${state.job.id}.${state.calls}`,
        operation,
        scopeId,
        input: { ...input, scopeId },
        config,
      },
      state.signal,
      state.lease(),
    );
    const seen = (output.documentId ??
      (output.page as { documentId?: unknown } | undefined)?.documentId ??
      (output.snapshot as { documentId?: unknown } | undefined)?.documentId) as string | undefined;
    if (typeof seen === "string" && seen) state.documents.set(scopeId, seen);
    // The tab's record follows the page, so tabs lists and the finish check see where it is now.
    const page = (output.page ?? output) as { url?: unknown; title?: unknown };
    const tab = agentTab(scopeId);
    if (tab && typeof page.url === "string" && /^https?:/.test(page.url)) {
      tab.url = page.url;
      if (typeof page.title === "string") tab.title = page.title;
    }
    return output;
  };
  /**
   * A read of a tab that just woke from sleep can catch it before its page has loaded, as
   * about:blank with no text. That says nothing about the page: wait for it, and if it stays blank,
   * open the address the tab last showed again.
   */
  const landed = async (scopeId: string, fetch: () => Promise<Record<string, unknown>>) => {
    const blank = (url: unknown) => typeof url !== "string" || url === "" || url === "about:blank";
    let page = await fetch();
    for (
      let attempt = 0;
      attempt < 2 && blank(page.url) && !blank(agentTab(scopeId)?.url);
      attempt++
    ) {
      await new Promise((done) => setTimeout(done, 1_500));
      page = await fetch();
    }
    const known = agentTab(scopeId)?.url;
    if (blank(page.url) && !blank(known)) {
      await operate("browser.navigate", scopeId, { url: known });
      page = await fetch();
    }
    return page;
  };
  const read = async (scopeId: string, maxChars: number) => {
    const page = await landed(scopeId, () => operate("browser.snapshot", scopeId, { maxChars }));
    return { url: page.url, title: page.title, tree: page.tree, truncated: page.truncated };
  };
  const document = async (scopeId: string) =>
    state.documents.get(scopeId) ??
    (await read(scopeId, 1_500), state.documents.get(scopeId) ?? "");
  /** A step's target: a ref, a locator, or words looked up with find. */
  const targetOf = async (scopeId: string, target: unknown): Promise<Record<string, unknown>> => {
    if (target === undefined || target === null) return {};
    if (typeof target === "string" && /^e\d+$/.test(target)) return { ref: target };
    if (typeof target === "object" && typeof (target as { role?: unknown }).role === "string") {
      const { role, name, index } = target as { role: string; name?: unknown; index?: unknown };
      return {
        locator: {
          role,
          name: String(name ?? ""),
          ...(typeof index === "number" ? { index } : {}),
        },
      };
    }
    // The object forms a model writes: { ref: "e12" }, or words under text, query, words, name or label.
    const given = target as {
      ref?: unknown;
      text?: unknown;
      query?: unknown;
      words?: unknown;
      name?: unknown;
      label?: unknown;
    };
    if (typeof target === "object" && typeof given.ref === "string" && /^e\d+$/.test(given.ref))
      return { ref: given.ref };
    const query =
      typeof target === "string"
        ? target
        : String(given.text ?? given.query ?? given.words ?? given.name ?? given.label ?? "");
    const found = await operate("browser.find", scopeId, { query, limit: 3 });
    const first = (found.matches as string[] | undefined)
      ?.map((line) => ref.exec(line)?.[1])
      .find(Boolean);
    if (!first)
      throw new Error(
        `Nothing on ${String(found.url ?? "the page")} matches "${query}". Read the page (tab.read()) and use a ref.`,
      );
    return { ref: first };
  };
  const act = async (args: Record<string, unknown>) => {
    const scopeId = ownTab(args.tab);
    const step: Record<string, unknown> = { action: args.action };
    for (const field of [
      "text",
      "values",
      "key",
      "direction",
      "amount",
      "submit",
      "allowConsequential",
    ] as const)
      if (args[field] !== undefined) step[field] = args[field];
    const attempt = async () => {
      const target = await targetOf(scopeId, args.target);
      const result = await operate("browser.steps", scopeId, {
        documentId: await document(scopeId),
        steps: [{ ...step, ...target }],
      });
      const outcome = (result.steps as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
      if (outcome.ok === false)
        throw new Error(String(outcome.error ?? "The step did not complete."));
      const page = (result.page ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        url: page.url,
        title: page.title,
        ...(outcome.note ? { note: outcome.note } : {}),
      };
    };
    try {
      return await attempt();
    } catch (error) {
      // The page changed since the host last read it: read it again and retry once, unless the
      // program named a ref from a read of its own, which belongs to the old page.
      if (
        !/stale|changed since/i.test(String(error)) ||
        (typeof args.target === "string" && /^e\d+$/.test(args.target))
      )
        throw error;
      state.documents.delete(scopeId);
      await read(scopeId, 1_500);
      return attempt();
    }
  };

  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case "open": {
        const url = unwrapSearchRedirect(String(args.url ?? ""));
        if (!/^https?:\/\//.test(url)) throw new Error("open(url) takes an http or https address.");
        if (++state.calls > MAX_CALLS)
          throw new Error(`A program makes at most ${MAX_CALLS} page calls.`);
        const scopeId = await state.openTab(url);
        const tab = agentTab(scopeId);
        return { id: scopeId, url: tab?.url ?? url, title: tab?.title ?? "" };
      }
      case "tabs":
        return agentTabsForTask(state.taskId()).map((tab) => ({
          id: tab.scopeId,
          url: tab.url,
          title: tab.title,
          ...(tab.byPerson ? { addedByPerson: true } : {}),
        }));
      case "tab": {
        const which = String(args.which ?? "");
        const found = agentTabsForTask(state.taskId()).find(
          (tab) => tab.scopeId === which || (which && tab.url.includes(which)),
        );
        if (!found) throw new Error(`No tab of yours is or shows "${which}".`);
        return { id: found.scopeId, url: found.url, title: found.title };
      }
      case "read":
        return read(
          ownTab(args.tab),
          Math.min(24_000, Math.max(1_000, Number(args.maxChars) || 12_000)),
        );
      case "text": {
        const scopeId = ownTab(args.tab);
        const page = await landed(scopeId, () => operate("browser.extract", scopeId, {}));
        return {
          url: page.url,
          title: page.title,
          text: clip(
            page.markdown,
            Math.min(60_000, Math.max(1_000, Number(args.maxChars) || 20_000)),
          ),
        };
      }
      case "find": {
        const found = await operate("browser.find", ownTab(args.tab), {
          query: String(args.query ?? ""),
          limit: Math.min(20, Number(args.limit) || 8),
        });
        return ((found.matches as string[] | undefined) ?? []).map((line) => ({
          ref: ref.exec(line)?.[1] ?? "",
          line,
        }));
      }
      case "goto": {
        const scopeId = ownTab(args.tab);
        const landed = await operate("browser.navigate", scopeId, {
          url: unwrapSearchRedirect(String(args.url ?? "")),
        });
        const snapshot = (landed.snapshot ?? {}) as Record<string, unknown>;
        const note =
          typeof snapshot.tree === "string" && snapshot.tree.startsWith("- note:")
            ? snapshot.tree.split("\n")[0]
            : undefined;
        return {
          url: landed.url,
          title: snapshot.title,
          ...(snapshot.loaded === false || note ? { note } : {}),
        };
      }
      case "act":
        return act(args);
      case "wait": {
        const waited = await operate("browser.wait_for", ownTab(args.tab), {
          text: args.text,
          textGone: args.textGone,
          urlIncludes: args.urlIncludes,
          timeoutMs: args.timeoutMs,
        });
        return { met: waited.met === true };
      }
      case "keep": {
        const scopeId = ownTab(args.tab);
        state.kept.add(scopeId);
        keepAgentTab(scopeId);
        return { kept: true };
      }
      case "note":
        if (state.notes.length >= 500) throw new Error("A program records at most 500 notes.");
        state.notes.push(args.row);
        return { noted: state.notes.length };
      case "sleep":
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(10_000, Math.max(0, Number(args.ms) || 0))),
        );
        return null;
      default:
        throw new Error(`Unknown page call ${name}.`);
    }
  };
}
