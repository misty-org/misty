import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@misty/ui";

type Call = { command: string; args?: Record<string, unknown> };
const calls: Call[] = [];

const root = JSON.parse(readFileSync("src/shared/registry/index.min.json", "utf8"));
const shards: Record<string, string> = JSON.parse(
  readFileSync("src/shared/registry/shards.json", "utf8"),
);
const section = (name: string) => JSON.parse(shards[root.sections[name].path]).data;
const top = (kind: string) => JSON.parse(shards[root.listings[kind].top.path]);

const engines = [
  { id: "claude", name: "Claude Code", installed: true, version: "2", supportsMcp: true },
  { id: "codex", name: "Codex", installed: true, version: "1", supportsMcp: true },
  { id: "gemini", name: "Gemini CLI", installed: true, version: "1", supportsMcp: true },
];

function answer(command: string, args?: Record<string, unknown>): unknown {
  calls.push({ command, args });
  switch (command) {
    case "registry_top":
      return top(String(args?.kind));
    case "registry_category": {
      const shard = top(String(args?.kind));
      return {
        ...shard,
        items: shard.items.filter((item: { category: string }) => item.category === args?.category),
      };
    }
    case "registry_search": {
      const words = String(args?.query).toLowerCase().split(/\s+/).filter(Boolean);
      const kinds = args?.kind ? [String(args.kind)] : ["skills", "templates", "plugins", "mcps"];
      return Object.fromEntries(
        kinds.map((kind) => {
          const items = top(kind).items.filter(
            (item: { name: string; description: string; maker: string }) =>
              words.every((word) =>
                `${item.name} ${item.description} ${item.maker}`.toLowerCase().includes(word),
              ),
          );
          return [kind, { count: items.length, items: items.slice(0, Number(args?.limit)) }];
        }),
      );
    }
    case "engines_list":
      return engines;
    case "engine_skills_query":
      return args?.mode === "updates"
        ? { updates: {} }
        : { targets: [], skills: [], generatedAt: 0 };
    case "engine_skills_mutate":
      return { ok: true };
    case "engine_mcp_inventory":
      return { engines: [], collectedAt: 0 };
    case "direct_apps_list":
      return [];
    case "registry_installs":
      return [];
    case "registry_plugin_install":
      return { result: "installed", placed: [] };
    case "registry_bundle_text":
      return "---\nname: Tester\ndescription: Checks things\n---\nYou check things.\n";
    case "registry_mcp_keys":
      return "/home/test/.misty/dev/default/.env/client/mcp/server.env";
    case "engine_mcp_add":
      return null;
    default:
      throw new Error(`no answer for ${command}`);
  }
}

vi.mock("@/shared/platform/native_invoke", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => answer(command, args)),
}));
vi.mock("@/shared/platform/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasTauriInternals: () => true,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ listen: async () => () => undefined }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("../personal/personal_agents_api", () => ({
  personalAgentsApi: {
    save: vi.fn(async (input: Record<string, unknown>) => {
      calls.push({ command: "agent_save", args: input });
      return { ...input, id: "agent-1" };
    }),
  },
}));

const { useRegistry } = await import("@/native/registry");
const { provideExploreApps } = await import("./explore_apps");
const { ExplorePage } = await import("./ExplorePage");

beforeAll(() => {
  useRegistry.setState({
    categories: section("categories"),
    apps: section("apps"),
    engines: section("engines"),
    speech: section("speech"),
    ignore: section("ignore"),
    listings: root.listings,
    published_at: "",
  });
  provideExploreApps({
    catalogLogoUrl: (app) => app.logo,
    useExploreInstalledApps: () => ({
      listed: section("apps"),
      loaded: true,
      error: "",
      reload: () => undefined,
      versionOf: () => undefined,
      approvedOf: () => [],
      downloadOf: () => undefined,
      install: async (appId: string) => calls.push({ command: "app_install", args: { appId } }),
      remove: async () => undefined,
      open: () => undefined,
      permissionLine: (permission: string) => permission,
    }),
  });
});

afterEach(() => {
  cleanup();
  calls.length = 0;
});

function show(tab: string) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/spaces/space-1/explore?tab=${tab}`]}>
        <ExplorePage spaceId="space-1" />
      </MemoryRouter>
    </TooltipProvider>,
  );
}

type Item = { name: string; id: string; category: string; rank?: number; bundle?: unknown };

const shown = (kind: string): Item[] => {
  const byCategory = new Map<string, Item[]>();
  for (const item of top(kind).items as Item[])
    byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
  return [...byCategory.values()].flatMap((items) =>
    items.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || a.name.localeCompare(b.name)).slice(0, 6),
  );
};

const firstWithBundle = (kind: string) => shown(kind).find((item) => item.bundle);

describe("Explore, from the registry's index", () => {
  it("lists every kind's categories as shelves from its top shard", async () => {
    for (const kind of ["skills", "templates", "plugins", "mcps"]) {
      show(kind);
      const shelf = await screen.findAllByRole("region");
      expect(shelf.length).toBeGreaterThan(0);
      await waitFor(() =>
        expect(
          calls.some((call) => call.command === "registry_top" && call.args?.kind === kind),
        ).toBe(true),
      );
      cleanup();
    }
  });

  it("installs a skill from its bundle into each ready engine", async () => {
    const skill = firstWithBundle("skills");
    expect(skill, "the bundled top shard holds a bundled skill").toBeTruthy();
    show("skills");
    const row = (await screen.findAllByText(skill!.name))[0].closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Get" }));
    await waitFor(() =>
      expect(calls.some((call) => call.command === "engine_skills_mutate")).toBe(true),
    );
    const sent = calls.find((call) => call.command === "engine_skills_mutate")?.args?.payload as {
      skill: { bundle: { sha256: string }; registry: { id: string } };
      targets: string[];
    };
    expect(sent.skill.registry.id).toBe(skill!.id);
    expect(sent.skill.bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.targets.sort()).toEqual(["claude", "codex", "gemini"]);
  });

  it("makes an agent from a template's bundled Markdown", async () => {
    const template = firstWithBundle("templates");
    expect(template).toBeTruthy();
    show("templates");
    const row = (await screen.findAllByText(template!.name))[0].closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Get" }));
    await waitFor(() => expect(calls.some((call) => call.command === "agent_save")).toBe(true));
    const saved = calls.find((call) => call.command === "agent_save")?.args as {
      soul: string;
      origin: string;
    };
    expect(saved.soul).toBe("You check things.");
    expect(saved.origin).toBe(`template:${template!.id}`);
    expect(calls.some((call) => call.command === "registry_bundle_text")).toBe(true);
  });

  it("installs a plugin natively in Claude Code and Codex and as skills elsewhere", async () => {
    const plugin = firstWithBundle("plugins");
    expect(plugin).toBeTruthy();
    show("plugins");
    const row = (await screen.findAllByText(plugin!.name))[0].closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Get" }));
    await waitFor(() =>
      expect(calls.some((call) => call.command === "registry_plugin_install")).toBe(true),
    );
    const request = calls.find((call) => call.command === "registry_plugin_install")?.args
      ?.request as {
      native: string[];
      skillTargets: string[];
      id: string;
    };
    expect(request.id).toBe(plugin!.id);
    expect(request.native.sort()).toEqual(["claude", "codex"]);
    expect(request.skillTargets).toEqual(["gemini"]);
  });

  it("asks an MCP server's keys in the Manage panel and runs it with them", async () => {
    const server = top("mcps").items.find(
      (item: { package?: { type: string }; env?: unknown[]; remote?: unknown }) =>
        !item.remote && item.package?.type === "npm" && item.env?.length,
    ) as { name: string; id: string; env: { name: string; required: boolean }[] } | undefined;
    expect(server).toBeTruthy();
    show("mcps");
    const row = (await screen.findAllByText(server!.name))[0].closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Get" }));
    const panel = await screen.findByRole("complementary", { name: "Manage" });
    for (const one of server!.env)
      fireEvent.change(within(panel).getByLabelText(new RegExp(one.name)), {
        target: { value: "value-for-test" },
      });
    fireEvent.click(within(panel).getByRole("button", { name: /Add to your engine/ }));
    await waitFor(() =>
      expect(calls.filter((call) => call.command === "engine_mcp_add").length).toBe(2),
    );
    const keys = calls.find((call) => call.command === "registry_mcp_keys")?.args as {
      server: string;
    };
    expect(keys.server).toBe(server!.id);
    const added = calls.find((call) => call.command === "engine_mcp_add")?.args?.request as {
      target: { command: string; args: string[] };
      env: unknown[];
    };
    expect(added.target.command).toBe("/bin/sh");
    expect(added.target.args).toContain("/home/test/.misty/dev/default/.env/client/mcp/server.env");
    expect(added.env).toEqual([]);
  });

  it("opens a product page with its facts and puts Manage in a side panel", async () => {
    const skill = top("skills").items[0] as { name: string };
    show("skills");
    fireEvent.click((await screen.findAllByText(skill.name))[0].closest("button") as HTMLElement);
    expect(await screen.findByRole("heading", { level: 1, name: skill.name })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Facts" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Information" })).toBeTruthy();
  });

  it("searches every kind at once", async () => {
    show("all");
    const word = (top("skills").items[0] as { name: string }).name.split(" ")[0];
    fireEvent.change(screen.getByLabelText("Search Explore"), { target: { value: word } });
    await waitFor(
      () => expect(calls.some((call) => call.command === "registry_search")).toBe(true),
      { timeout: 3000 },
    );
    expect(await screen.findByRole("region", { name: "Skills" })).toBeTruthy();
  });
});
