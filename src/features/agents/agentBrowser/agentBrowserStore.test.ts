import { beforeEach, describe, expect, it } from "vitest";
import {
  addBrowserTab,
  browserTabActed,
  finishTaskViews,
  hydrateAgentBrowser,
  MAX_VIEWS,
  removeBrowserTab,
  resetAgentBrowser,
  useAgentBrowser,
  viewOfTab,
} from "./agentBrowserStore";

const tab = (scopeId: string) => ({
  scopeId,
  url: `https://example.com/${scopeId}`,
  title: "",
  viewId: `page-${scopeId}`,
});
const chat = () => useAgentBrowser.getState().chats.c!;

beforeEach(resetAgentBrowser);

describe("the agent browser's views", () => {
  it("opens a chat with its first view as the PiP, showing the newest tab", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("a"));
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("b"));
    expect(chat()).toMatchObject({ shownView: "task", expanded: false });
    expect(chat().views[0]).toMatchObject({ tabs: ["a", "b"], shownScope: "b", status: "working" });
  });

  it("keeps each sub-agent in a view of its own, at most four", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("main"));
    for (let index = 0; index < MAX_VIEWS + 1; index++)
      addBrowserTab(
        "c",
        { id: `child-${index}`, label: `Helper ${index}`, taskId: "task" },
        tab(`child-${index}`),
      );
    expect(chat().views).toHaveLength(MAX_VIEWS);
    expect(chat().views[0]!.label).toBe("Main");
    expect(viewOfTab("child-4")?.view.label).toBe("Helper 4");
  });

  it("follows the agent within a view, and marks a finished task's views done", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("a"));
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("b"));
    browserTabActed("a");
    expect(chat().views[0]!.shownScope).toBe("a");
    finishTaskViews("task");
    expect(chat().views[0]!.status).toBe("done");
  });

  it("drops a closed tab and shows the view's last one", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("a"));
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("b"));
    removeBrowserTab("b");
    expect(chat().views[0]).toMatchObject({ tabs: ["a"], shownScope: "a" });
    expect(useAgentBrowser.getState().tabs.b).toBeUndefined();
  });
});

describe("a reload", () => {
  it("brings the views and tabs back asleep and done, and survives a bad save", () => {
    const saved = JSON.stringify({
      chats: {
        c: {
          conversationId: "c",
          shownView: "task",
          expanded: false,
          views: [
            {
              id: "task",
              label: "Main",
              taskId: "task",
              tabs: ["a"],
              shownScope: "a",
              status: "working",
              lastActed: 1,
            },
          ],
        },
      },
      tabs: {
        a: {
          scopeId: "a",
          url: "https://example.com",
          title: "Example",
          viewId: "page-a",
          loading: true,
        },
      },
    });
    const state = hydrateAgentBrowser(saved);
    expect(state.chats.c!.views[0]!.status).toBe("done");
    expect(state.chats.c!.expanded).toBe(false);
    expect(
      hydrateAgentBrowser(saved.replace('"expanded":false', '"expanded":true')).chats.c!.expanded,
    ).toBe(false);
    expect(state.tabs.a).toMatchObject({
      url: "https://example.com",
      title: "Example",
      viewId: "",
      loading: false,
    });
    expect(hydrateAgentBrowser("not json")).toEqual({ chats: {}, tabs: {} });
    expect(hydrateAgentBrowser(null)).toEqual({ chats: {}, tabs: {} });
  });
});

describe("the main agent's view", () => {
  it("is one per chat across runs, taken over by the latest run", () => {
    const tab = (scopeId: string) => ({
      scopeId,
      url: `https://example.com/${scopeId}`,
      title: "",
      viewId: `page-${scopeId}`,
    });
    addBrowserTab("c", { id: "run-1", label: "Main", taskId: "run-1" }, tab("a"));
    finishTaskViews("run-1");
    addBrowserTab("c", { id: "run-2", label: "Main", taskId: "run-2" }, tab("b"));
    const chat = useAgentBrowser.getState().chats.c!;
    expect(chat.views).toHaveLength(1);
    expect(chat.views[0]).toMatchObject({
      taskId: "run-2",
      status: "working",
      tabs: ["a", "b"],
      shownScope: "b",
    });
    addBrowserTab("c", { id: "sub-1", label: "Research", taskId: "run-2" }, tab("c"));
    expect(useAgentBrowser.getState().chats.c!.views).toHaveLength(2);
  });
});
