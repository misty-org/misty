import { browserLibrary, type BrowserHistoryVisit } from "@/features/browser";
import { allLayoutViews, parseBrowserViewState, useWorkspaceStore } from "@/features/workspace";
import { compatObject, compatTime, emitCompatEvent, type CompatHandler } from "./events";

const day = 24 * 60 * 60 * 1000;

function url(details: unknown): string {
  const value = compatObject(details).url;
  if (typeof value !== "string" || !/^https?:/i.test(value))
    throw new Error("A http or https URL is required.");
  return value;
}

/** Groups visits into WebExtension HistoryItems, newest page first. */
function historyItems(visits: BrowserHistoryVisit[]) {
  const pages = new Map<
    string,
    {
      id: string;
      url: string;
      title: string;
      lastVisitTime: number;
      visitCount: number;
      typedCount: number;
    }
  >();
  for (const visit of visits) {
    const page = pages.get(visit.url);
    if (page) {
      page.visitCount += 1;
      page.lastVisitTime = Math.max(page.lastVisitTime, visit.visitedAt);
    } else {
      pages.set(visit.url, {
        id: String(visit.id),
        url: visit.url,
        title: visit.title,
        lastVisitTime: visit.visitedAt,
        visitCount: 1,
        typedCount: 0,
      });
    }
  }
  return [...pages.values()].sort((a, b) => b.lastVisitTime - a.lastVisitTime);
}

async function visitsBetween(
  start: number,
  end: number,
  text = "",
): Promise<BrowserHistoryVisit[]> {
  const visits = await browserLibrary.history({ text, before: end, limit: 5000 });
  return visits.filter((visit) => visit.visitedAt >= start && visit.visitedAt <= end);
}

/** Current address of each browser view whose visits belong in history. */
function historyAddresses(): Map<string, { url: string; title: string }> {
  const workspace = useWorkspaceStore.getState();
  const addresses = new Map<string, { url: string; title: string }>();
  for (const window of workspace.windowsByScope[workspace.activeScopeKey] ?? []) {
    for (const view of allLayoutViews(window.layout)) {
      if (view.surfaceId !== "browser") continue;
      const state = parseBrowserViewState(view.state);
      // History leaves out private tabs and pages agents open for their own work.
      if (state.private || state.agentOwned || !/^https?:/i.test(state.url ?? "")) continue;
      addresses.set(view.id, { url: state.url!, title: view.title ?? "" });
    }
  }
  return addresses;
}

/** Reports navigations in browser tabs as history.onVisited. */
export function watchVisits(): () => void {
  let previous = historyAddresses();
  return useWorkspaceStore.subscribe((state, prior) => {
    if (state.windowsByScope === prior.windowsByScope && state.layout === prior.layout) return;
    const current = historyAddresses();
    // Switching Spaces shows other tabs; it does not visit their pages.
    if (state.activeScopeKey !== prior.activeScopeKey) {
      previous = current;
      return;
    }
    for (const [id, page] of current) {
      if (previous.get(id)?.url === page.url) continue;
      emitCompatEvent("history.onVisited", [
        {
          id,
          url: page.url,
          title: page.title,
          lastVisitTime: Date.now(),
          visitCount: 1,
          typedCount: 0,
        },
      ]);
    }
    previous = current;
  });
}

export const historyHandlers: Record<string, CompatHandler> = {
  "history.search": async ([value]) => {
    const query = compatObject(value);
    const now = Date.now();
    // Like Firefox and Chrome, an omitted start time means the last 24 hours.
    const start = compatTime(query.startTime, now - day);
    const end = compatTime(query.endTime, now);
    const text = typeof query.text === "string" ? query.text : "";
    const max = Number(query.maxResults) > 0 ? Number(query.maxResults) : 100;
    return historyItems(await visitsBetween(start, end, text)).slice(0, max);
  },
  "history.getVisits": async ([details]) => {
    const target = url(details);
    const visits = await browserLibrary.history({ text: target, limit: 5000 });
    return visits
      .filter((visit) => visit.url === target)
      .map((visit) => ({
        id: String(visit.id),
        visitId: String(visit.id),
        visitTime: visit.visitedAt,
        referringVisitId: "-1",
        transition: "link",
      }));
  },
  "history.addUrl": async ([details]) => {
    const title = compatObject(details).title;
    await browserLibrary.recordVisit({
      url: url(details),
      title: typeof title === "string" ? title : "",
    });
  },
  "history.deleteUrl": async ([details]) => {
    const target = url(details);
    await browserLibrary.forgetPage({ url: target });
    emitCompatEvent("history.onVisitRemoved", [{ allHistory: false, urls: [target] }]);
  },
  "history.deleteRange": async ([range]) => {
    const value = compatObject(range);
    const start = compatTime(value.startTime, 0);
    const end = compatTime(value.endTime, Date.now());
    const visits = await visitsBetween(start, end);
    if (end >= Date.now() - 1000) await browserLibrary.clearHistory({ since: start });
    else if (visits.length) await browserLibrary.deleteVisits(visits.map((visit) => visit.id));
    const urls = [...new Set(visits.map((visit) => visit.url))];
    emitCompatEvent("history.onVisitRemoved", [{ allHistory: false, urls }]);
  },
  "history.deleteAll": async () => {
    await browserLibrary.clearHistory({});
    emitCompatEvent("history.onVisitRemoved", [{ allHistory: true, urls: [] }]);
  },
  "topSites.get": async () => {
    const sites = await browserLibrary.historySuggestions({ text: "", limit: 12 });
    return sites.map((site) => ({ url: site.url, title: site.title, type: "url" }));
  },
};
