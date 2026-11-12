// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillMutationResult, SkillRow, SkillsInstalledResult } from "./types";

const api = vi.hoisted(() => ({
  installed: vi.fn(),
  discover: vi.fn(),
  search: vi.fn(),
  popular: vi.fn(),
  repos: vi.fn(),
  updates: vi.fn(),
  activity: vi.fn(),
  usage: vi.fn(),
  content: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  restore: vi.fn(),
  setTargets: vi.fn(),
  importLocal: vi.fn(),
  deleteLocal: vi.fn(),
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
}));

vi.mock("./api", () => ({
  SkillsHubError: class SkillsHubError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  skillsHubApi: api,
}));

vi.mock("../EngineMark", () => ({ EngineMark: () => null, hasEngineMark: () => false }));
vi.mock("../host", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  HostMarkdown: ({ children }: { children: string }) => (
    <pre data-testid="markdown">{children}</pre>
  ),
}));

vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { SkillsSection } from "./SkillsSection";
import { InstalledPane } from "./InstalledPane";

// jsdom has no ResizeObserver; Radix measures with one.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TARGETS = [
  {
    id: "claude",
    label: "Claude",
    path: "/home/u/.claude/skills",
    readonly: false,
    available: true,
  },
  {
    id: "codex",
    label: "Codex",
    path: "/home/u/.codex/skills",
    readonly: false,
    available: true,
  },
  {
    id: "grok",
    label: "Grok",
    path: "/home/u/.grok/skills",
    readonly: false,
    available: true,
  },
  // Not installed and no copy anywhere: hidden from rows and chips.
  {
    id: "hermes",
    label: "Hermes",
    path: "/home/u/.hermes/skills",
    readonly: false,
    available: false,
  },
];

function managedSkill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "anthropics/skills:alpha",
    key: "anthropics/skills:alpha",
    name: "alpha",
    description: "managed skill",
    directory: "alpha",
    sourceDirectory: "alpha",
    readmeUrl: "https://github.com/anthropics/skills/blob/main/alpha/SKILL.md",
    repoOwner: "anthropics",
    repoName: "skills",
    repoBranch: "main",
    installedAt: 1,
    managed: true,
    sourceKind: "managed",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "off", grok: "off", hermes: "off" },
    ...overrides,
  };
}

function localSkill(overrides: Partial<SkillRow> = {}): SkillRow {
  return {
    id: "local:beta",
    key: "local:beta",
    name: "beta",
    description: "local skill",
    directory: "beta",
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    installedAt: null,
    managed: false,
    sourceKind: "local",
    readonly: false,
    targets: ["claude"],
    targetStates: { claude: "synced", codex: "orphan", grok: "off", hermes: "off" },
    targetPaths: { claude: "/home/u/.claude/skills/beta" },
    ...overrides,
  };
}

function installedPayload(skills: SkillRow[]): SkillsInstalledResult {
  return { targets: TARGETS, skills, generatedAt: Date.now() };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.installed.mockResolvedValue(installedPayload([managedSkill(), localSkill()]));
  api.updates.mockResolvedValue({ updates: {}, checkedAt: Date.now(), cached: false });
  api.content.mockResolvedValue({
    directory: "alpha",
    path: "/home/u/.claude/skills/alpha/SKILL.md",
    markdown: "---\nname: alpha\n---\nbody",
    truncated: false,
  });
  api.usage.mockResolvedValue({
    engine: "claude",
    scope: "claude_code_transcripts",
    generatedAt: Date.now(),
    scannedFiles: 0,
    totalInvocations: 0,
    cached: false,
    skills: [],
    unusedInstalled: [],
  });
  api.activity.mockResolvedValue({ activity: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPane() {
  await act(async () => {
    root.render(<InstalledPane onBrowse={() => undefined} />);
  });
}

function buttonByText(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

/** Exact-text match: chips share substrings with action buttons ("Local" is
 *  inside "Import local skill"). */
function buttonExact(text: string, scope: ParentNode = document.body): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found (exact): ${text}`);
  return button;
}

/** The open details dialog for alpha, if any. */
function detailDialog(): Element | null {
  return (
    [...document.querySelectorAll('[role="dialog"]')].find((dialog) =>
      dialog.querySelector("h2")?.textContent?.includes("alpha"),
    ) ?? null
  );
}

function radioByText(text: string): HTMLButtonElement {
  const radio = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!radio) throw new Error(`radio not found: ${text}`);
  return radio;
}

describe("InstalledPane", () => {
  it("lists skills with source badges and filters by engine", async () => {
    await renderPane();
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");

    // alpha syncs only to Claude and beta has a copy on Codex: filtering by Codex leaves beta.
    await act(async () => {
      buttonExact("Codex").click();
    });
    expect(document.body.textContent).not.toContain("managed skill");
    expect(document.body.textContent).toContain("beta");

    await act(async () => {
      buttonExact("All engines").click();
    });
    expect(document.body.textContent).toContain("managed skill");
  });

  it("opens the detail dialog and syncs a second engine", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [
        { target: "claude", ok: true, error: null },
        { target: "codex", ok: true, error: null },
      ],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(detailDialog()).toBeTruthy();

    const codex = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Codex"),
    );
    const checkbox = codex?.querySelector<HTMLInputElement>("button[role=checkbox]");
    expect(checkbox).toBeTruthy();
    await act(async () => {
      checkbox?.click();
    });
    expect(api.setTargets).toHaveBeenCalledWith("anthropics/skills:alpha", ["claude", "codex"]);
    // A single-engine action names the engine instead of reading like a bulk result.
    expect(document.body.textContent).toContain("alpha synced to Codex");
    expect(document.body.textContent).not.toContain("synced to every engine");
  });

  it("removes one engine copy from the row icon without opening the dialog", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "claude", ok: true, error: null }],
    } satisfies SkillMutationResult);
    await renderPane();
    const rowIcons = () =>
      document.querySelectorAll<HTMLButtonElement>('button[data-target="claude"]');
    expect(rowIcons().length).toBeGreaterThan(0);
    await act(async () => {
      rowIcons()[0].click();
    });
    // alpha has one copy, on claude: pressing it turns that engine off.
    expect(api.setTargets).toHaveBeenCalledWith("anthropics/skills:alpha", []);
    expect(detailDialog()).toBeNull();
    // An unmanaged local skill's own copy can't be turned off from the row (the backend wouldn't delete it).
    const betaRow = document.querySelector('[aria-label="Show beta"]')?.parentElement;
    expect(
      betaRow?.querySelector<HTMLButtonElement>('button[data-target="claude"]')?.disabled,
    ).toBe(true);
  });

  it("shows only engines that hold a copy in the row strip", async () => {
    await renderPane();
    const alphaRow = document.querySelector('[aria-label="Show alpha"]')?.parentElement;
    const stateOf = (row: Element | null | undefined, engine: string) =>
      row?.querySelector<HTMLButtonElement>(`button[data-target="${engine}"]`)?.dataset.targetState;
    expect(stateOf(alphaRow, "claude")).toBe("synced");
    // Engines without a copy, or not installed, take no room in the row (engines are added in the details).
    expect(stateOf(alphaRow, "codex")).toBeUndefined();
    expect(stateOf(alphaRow, "grok")).toBeUndefined();
    expect(alphaRow?.querySelector('button[data-target="hermes"]')).toBeNull();
    expect(
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Hermes",
      ),
    ).toBe(false);

    // beta lost its codex copy: it still shows in the row, or the way to clean up disappears.
    const betaRow = document.querySelector('[aria-label="Show beta"]')?.parentElement;
    expect(stateOf(betaRow, "codex")).toBe("orphan");
    expect(
      betaRow?.querySelector('button[data-target="codex"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(stateOf(betaRow, "grok")).toBeUndefined();
  });

  it("keeps a user-owned local copy and says so instead of claiming removal", async () => {
    const synced = installedPayload([
      managedSkill({
        targets: ["claude", "grok"],
        targetStates: { claude: "synced", codex: "off", grok: "synced", hermes: "off" },
      }),
      localSkill(),
    ]);
    api.installed.mockResolvedValueOnce(synced).mockResolvedValue(synced);
    // The backend reports keeping the person's own source copy as kept: the UI mustn't say removed.
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "grok", ok: true, error: null, kept: true }],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    const grok = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Grok"),
    );
    await act(async () => {
      grok?.querySelector<HTMLInputElement>("button[role=checkbox]")?.click();
    });
    expect(document.body.textContent).toContain("alpha kept your own local copy (Grok)");
  });

  it("locks turning off a local skill's own copies and offers installed engines on import", async () => {
    await renderPane();
    const betaRow = document.querySelector('[aria-label="Show beta"]')?.parentElement;
    const localCopy = betaRow?.querySelector<HTMLButtonElement>('button[data-target="claude"]');
    expect(localCopy?.dataset.targetState).toBe("synced");
    expect(localCopy?.disabled).toBe(true);
    expect(localCopy?.getAttribute("title")).toContain("Misty never deletes it");

    await act(async () => {
      buttonExact("Import local skill").click();
    });
    const labels = [...document.querySelectorAll("label")].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toContain("Claude");
    expect(labels).toContain("Codex");
    expect(labels).toContain("Grok");
    // Engines that aren't installed aren't offered as import targets.
    expect(labels.some((label) => label?.includes("Hermes"))).toBe(false);
  });

  it("filters the list by an engine chip", async () => {
    await renderPane();
    await act(async () => {
      buttonExact("Grok").click();
    });
    expect(document.body.textContent).toContain("No skill matches these filters");
    expect(document.body.textContent).not.toContain("managed skill");
  });

  it("reports a failed engine toggle instead of an all-synced message", async () => {
    api.setTargets.mockResolvedValue({
      ok: true,
      targetResults: [{ target: "codex", ok: false, error: "permission denied" }],
    } satisfies SkillMutationResult);
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    const codex = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) =>
      label.textContent?.includes("Codex"),
    );
    await act(async () => {
      codex?.querySelector<HTMLInputElement>("button[role=checkbox]")?.click();
    });
    expect(document.body.textContent).toContain("Codex failed: permission denied");
    expect(document.body.textContent).not.toContain("synced to every engine");
  });

  it("shows invocation activity and the remove-from-all-agents action", async () => {
    api.usage.mockResolvedValue({
      engine: "claude",
      scope: "claude_code_transcripts",
      generatedAt: Date.now(),
      scannedFiles: 3,
      totalInvocations: 4,
      cached: false,
      skills: [
        {
          skill: "alpha",
          invocations: 4,
          lastUsedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          tokens: null,
          installed: true,
          skillId: "anthropics/skills:alpha",
          directory: "alpha",
        },
      ],
      unusedInstalled: [],
    });
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(api.usage).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Invocations");
    expect(document.body.textContent).toContain("2d ago");
    expect(document.body.textContent).toContain("Sync to");
    // A managed skill has "Remove from every engine" as its one destructive action (confirmed).
    await act(async () => {
      buttonByText("Remove from every engine").click();
    });
    expect(document.body.textContent).toContain("Uninstall alpha?");
  });

  it("marks never-used skills instead of fabricating activity", async () => {
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(document.body.textContent).toContain("Never used");
    expect(document.body.textContent).toContain("Never invoked");
  });

  it("does not claim a skill was never used when usage stats are unavailable", async () => {
    api.usage.mockRejectedValue(new Error("transcripts unreadable"));
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(document.body.textContent).toContain("Usage is unavailable");
    expect(document.body.textContent).not.toContain("Never invoked");
  });

  it("uninstalls through a confirmation and offers the trash restore", async () => {
    api.uninstall.mockResolvedValue({
      ok: true,
      trashed: true,
      restoreId: "anthropics/skills:alpha",
      ttlMs: 300000,
    } satisfies SkillMutationResult);
    api.restore.mockResolvedValue({ ok: true } satisfies SkillMutationResult);
    api.installed
      .mockResolvedValueOnce(installedPayload([managedSkill(), localSkill()]))
      .mockResolvedValue(installedPayload([localSkill()]));
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    await act(async () => {
      buttonByText("Remove from every engine").click();
    });
    expect(document.body.textContent).toContain("Uninstall alpha?");
    await act(async () => {
      buttonExact("Uninstall").click();
    });
    expect(api.uninstall).toHaveBeenCalledWith("anthropics/skills:alpha");
    // Once the row leaves the list the details close (the selection comes from the list).
    expect(detailDialog()).toBeNull();

    await act(async () => {
      buttonByText("Undo uninstall").click();
    });
    expect(api.restore).toHaveBeenCalledWith("anthropics/skills:alpha");
  });

  it("keeps Adopt out of the row and disables it while it runs in the detail panel", async () => {
    let release: (value: SkillMutationResult) => void = () => undefined;
    api.importLocal.mockImplementation(
      () =>
        new Promise<SkillMutationResult>((resolve) => {
          release = resolve;
        }),
    );
    await renderPane();
    const adoptButtons = () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) => button.textContent?.trim() === "Adopt",
      );
    // Adopt isn't a row action: a local skill is adopted in its details (or by ticking a Sync to engine).
    expect(adoptButtons()).toHaveLength(0);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Show beta"]')?.click();
    });
    expect(adoptButtons()).toHaveLength(1);
    await act(async () => {
      adoptButtons()[0].click();
    });
    // Only the pending entry disables; the managed row's own buttons stay live.
    expect(adoptButtons()[0].disabled).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.includes("alpha") && !button.disabled,
      ),
    ).toBe(true);

    await act(async () => {
      release({ ok: true });
    });
    expect(api.importLocal).toHaveBeenCalledTimes(1);
  });

  it("shows the SKILL.md content in the detail dialog", async () => {
    await renderPane();
    await act(async () => {
      buttonByText("alpha").click();
    });
    expect(api.content).toHaveBeenCalledWith("alpha");
    expect(document.querySelector('[data-testid="markdown"]')?.textContent).toContain(
      "name: alpha",
    );
  });
});

describe("SkillsSection usage and discovery safety", () => {
  it("does not load discovery or usage data until their tabs open", async () => {
    api.discover.mockResolvedValue({ skills: [], cached: false, generatedAt: 0 });
    api.popular.mockResolvedValue({ skills: [], cached: false, generatedAt: 0 });
    api.repos.mockResolvedValue({ repos: [] });
    api.usage.mockResolvedValue({
      engine: "claude",
      scope: "claude_code_transcripts",
      generatedAt: Date.now(),
      scannedFiles: 0,
      totalInvocations: 0,
      cached: false,
      skills: [],
      unusedInstalled: [],
    });
    api.activity.mockResolvedValue({ activity: [] });

    await act(async () => {
      root.render(<SkillsSection />);
    });
    expect(api.installed).toHaveBeenCalledTimes(1);
    expect(api.popular).not.toHaveBeenCalled();
    expect(api.usage).not.toHaveBeenCalled();

    await act(async () => {
      radioByText("Discover").click();
    });
    expect(api.popular).toHaveBeenCalled();
    expect(api.usage).not.toHaveBeenCalled();

    await act(async () => {
      radioByText("Usage").click();
    });
    expect(api.usage).toHaveBeenCalled();
  });
});
