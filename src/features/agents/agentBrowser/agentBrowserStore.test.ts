import { beforeEach, describe, expect, it } from "vitest";
import {
  addBrowserTab,
  browserTabActed,
  finishTaskViews,
  MAX_VIEWS,
  removeBrowserTab,
  resetAgentBrowser,
  useAgentBrowser,
  viewOfTab,
} from "./agentBrowserStore";

const tab = (scopeId: string) => ({ scopeId, url: `https://example.com/${scopeId}`, title: "", asleep: false });
const chat = () => useAgentBrowser.getState().chats.c!;

beforeEach(resetAgentBrowser);

describe("the agent browser's views", () => {
  it("opens a chat with its first view in the split, showing the newest tab", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("a"));
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("b"));
    expect(chat()).toMatchObject({ shownView: "task", expanded: true });
    expect(chat().views[0]).toMatchObject({ tabs: ["a", "b"], shownScope: "b", status: "working" });
  });

  it("keeps each sub-agent in a view of its own, at most four", () => {
    addBrowserTab("c", { id: "task", label: "Main", taskId: "task" }, tab("main"));
    for (let index = 0; index < MAX_VIEWS + 1; index++)
      addBrowserTab("c", { id: `child-${index}`, label: `Helper ${index}`, taskId: "task" }, tab(`child-${index}`));
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
