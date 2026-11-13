import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  searched: [] as string[],
  routes: [] as string[],
  asked: [] as [string, string][],
  found: [] as [string, string][],
  made: [] as [string, string][],
}));

vi.mock("@/features/account", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/features/shortcuts", () => ({
  ShortcutText: () => null,
  useShortcutHandler: () => undefined,
}));
vi.mock("@/features/commands", () => ({
  useCommands: () => [
    { id: "theme", title: () => "Toggle theme", keywords: () => ["dark"], run: vi.fn() },
  ],
}));
vi.mock("@/features/settings", () => ({ openSettings: vi.fn(), searchSettings: () => [] }));
vi.mock("../spaceNavigation", () => ({
  agentChatRoute: (agent: string, chat?: string) => `/agents?agent=${agent}&conversation=${chat}`,
  openNewChat: vi.fn(),
  openWorkspaceRoute: (route: string) => calls.routes.push(route),
}));
vi.mock("@/features/agents", () => {
  const agents = [
    { id: "a1", name: "Codex", engine: "codex", enabled: true, system_managed: false },
  ];
  const conversations = [
    {
      id: "c1",
      agentId: "a1",
      title: "Release notes",
      updatedAt: "2026-11-10T10:00:00Z",
      messages: [{ id: "m1", content: "We should ship the quarterly budget review on Friday" }],
    },
  ];
  const store = <T,>(state: T) => {
    const hook = (select: (value: T) => unknown) => select(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    AgentAvatar: () => <span />,
    askInNewChat: async (agent: string, prompt: string) => {
      calls.asked.push([agent, prompt]);
      return "c9";
    },
    directAppsApi: {
      catalog: async () => ({
        apps: [
          {
            name: "Linear",
            description: "Plan issues",
            url: "u",
            app: "linear",
            icon: "",
            checked: true,
          },
        ],
        total: 1,
      }),
    },
    messageSearchText: (message: { content: string }) => message.content,
    openFolderFile: vi.fn(),
    readDeviceState: async () => null,
    requestChatFind: (chat: string, words: string) => calls.found.push([chat, words]),
    resumeInNewChat: vi.fn(),
    searchEngineSessions: async () => ({ hits: [], hasMore: false }),
    searchFolderFiles: async () => [],
    searchNotebooks: async () => ({ hits: [], byMeaning: false }),
    shortAgo: () => "1d",
    tutorChatIds: () => new Set(),
    updateDeviceState: async () => ({}),
    useLessonStore: store({ lessons: {} }),
    useMistyStore: store({ conversations }),
    usePersonalAgentsStore: store({ agents }),
    useTutorStore: store({ jobs: {}, notebooks: {} }),
  };
});
vi.mock("@/features/spaces", () => {
  const Icon = () => null;
  const kind = { Icon, tone: "neutral", label: "Note" };
  return {
    createSpaceEvent: vi.fn(),
    createSpaceNote: vi.fn(),
    createSpaceTask: async (space: string, title: string) => {
      calls.made.push([space, title]);
      return "/spaces/s1/planner?task=t9";
    },
    kindIcon: { chat: kind, note: kind, drawing: kind, image: kind, file: kind },
    searchSpaceText: async (_space: string, words: string) => {
      calls.searched.push(words);
      return [];
    },
    spaceEvents: async () => [],
    spaceTasks: async () => [
      {
        kind: "task",
        id: "t1",
        title: "Budget spreadsheet",
        text: "",
        href: "/spaces/s1/planner?task=t1",
      },
    ],
    useSpaceGallery: () => ({ items: [], loading: false }),
    useWindowSpace: () => ({ id: "s1" }),
  };
});

import { useSearchDialog } from "./searchStore";
import { WorkspaceSearch } from "./WorkspaceSearch";

let host: HTMLDivElement;
let root: Root;

const input = () => document.querySelector<HTMLInputElement>(".misty-search-input")!;
const rows = () =>
  [...document.querySelectorAll<HTMLElement>(".misty-search-item")].map(
    (row) => row.querySelector(".misty-search-title")?.textContent ?? "",
  );
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
/** Past the pause that keeps typing from asking every source on each key. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

beforeEach(() => {
  // cmdk keeps the selected row in view; jsdom draws nothing to scroll.
  Element.prototype.scrollIntoView ??= () => undefined;
  calls.routes.length = 0;
  calls.asked.length = 0;
  calls.found.length = 0;
  calls.made.length = 0;
  calls.searched.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<WorkspaceSearch onOpen={() => undefined} />));
  act(() => useSearchDialog.getState().setOpen(true));
});

afterEach(() => {
  act(() => useSearchDialog.getState().setOpen(false));
  act(() => root.unmount());
  host.remove();
});

describe("⌘K search", () => {
  it("finds a chat by what was said in it and opens it at the words", async () => {
    type("budget");
    await settle();
    expect(rows()).toContain("Release notes");
    expect(rows()).toContain("Budget spreadsheet");
    const excerpt = document.querySelector(".misty-search-excerpt mark");
    expect(excerpt?.textContent).toBe("budget");
    const chat = [...document.querySelectorAll<HTMLElement>(".misty-search-item")].find((row) =>
      row.textContent?.includes("Release notes"),
    )!;
    act(() => chat.click());
    expect(calls.found).toEqual([["c1", "budget"]]);
    expect(calls.routes).toEqual(["/agents?agent=a1&conversation=c1"]);
  });

  it("forgives a typo and finds apps and commands", async () => {
    type("lnear");
    await settle();
    expect(rows()).toContain("Connect Linear");
    type("> dark");
    await settle();
    expect(rows()).toEqual(["Toggle theme"]);
  });

  it("asks the usual agent with ⌘↵", async () => {
    type("summarize the week");
    await act(async () => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });
    expect(calls.asked).toEqual([["a1", "summarize the week"]]);
    expect(calls.routes).toEqual(["/agents?agent=a1&conversation=c9"]);
  });

  it("never sends what is asked of an agent to the server", async () => {
    type("@Codex draft the launch email");
    await settle();
    expect(rows()[0]).toBe("Ask Codex: draft the launch email");
    expect(calls.searched).toEqual([]);
    type("launch email");
    await settle();
    expect(calls.searched).toEqual(["launch email"]);
  });

  it("makes a task from task:", async () => {
    type("task: call the bank");
    expect(rows()[0]).toBe("New task: call the bank");
    await act(async () => {
      document.querySelector<HTMLElement>(".misty-search-item")!.click();
    });
    expect(calls.made).toEqual([["s1", "call the bank"]]);
    expect(calls.routes).toEqual(["/spaces/s1/planner?task=t9"]);
  });
});
