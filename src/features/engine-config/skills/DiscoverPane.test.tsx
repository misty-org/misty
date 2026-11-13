// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * Discover regression: a skills.sh entry has only name / repo / installs, and opening its row
 * reads SKILL.md from the repository (`remote_skill_content`). Three things are watched: the row
 * doesn't repeat the repository, the details really read the body, and a missing body is
 * explained in plain words with the repository as a way out, not a raw error.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredSkill, SkillRemoteContent } from "./types";

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
  remoteContent: vi.fn(),
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

import { DiscoverPane } from "./DiscoverPane";

const popularSkill: DiscoveredSkill = {
  key: "mattpocock/skills/grill-with-docs",
  name: "grill-with-docs",
  description: "",
  directory: "grill-with-docs",
  readmeUrl: "https://github.com/mattpocock/skills",
  repoOwner: "mattpocock",
  repoName: "skills",
  repoBranch: "main",
  installs: 1028594,
};

const remote: SkillRemoteContent = {
  name: "grill-with-docs",
  description: "A relentless interview to sharpen a plan or design.",
  directory: "skills/engineering/grill-with-docs",
  path: "skills/engineering/grill-with-docs/SKILL.md",
  url: "https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/SKILL.md",
  repoUrl: "https://github.com/mattpocock/skills",
  markdown: "---\nname: grill-with-docs\n---\nAsk one question at a time.",
  truncated: false,
  branch: "main",
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.popular.mockResolvedValue({ skills: [popularSkill], cached: false, generatedAt: Date.now() });
  api.discover.mockResolvedValue({ skills: [], cached: false, generatedAt: Date.now() });
  api.repos.mockResolvedValue({ repos: [] });
  api.remoteContent.mockResolvedValue(remote);
  api.install.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

async function renderPane() {
  await act(async () => {
    render(<DiscoverPane />);
  });
  await act(async () => {});
}

function rowText(): string {
  return document.querySelector("li")?.textContent ?? "";
}

async function openDetails(name = "grill-with-docs") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: `Show ${name}` }));
  });
  await act(async () => {});
}

describe("DiscoverPane", () => {
  it("lists a skills.sh entry with repo and installs exactly once", async () => {
    await renderPane();
    const text = rowText();
    expect(text).toContain("grill-with-docs");
    expect(text).toContain("mattpocock/skills");
    expect(text).toContain("1028594 installs");
    // Without a description the repository isn't shown twice (the second line is repo and installs).
    expect(text.split("mattpocock/skills").length - 1).toBe(1);
    expect(api.remoteContent).not.toHaveBeenCalled();
  });

  it("reads the SKILL.md from the repository when the row is opened", async () => {
    await renderPane();
    await openDetails();
    expect(api.remoteContent).toHaveBeenCalledWith(popularSkill);
    expect(screen.getByTestId("markdown").textContent).toContain("Ask one question at a time.");
    expect(document.body.textContent).toContain(
      "A relentless interview to sharpen a plan or design.",
    );
  });

  it("explains a missing SKILL.md and offers the repository instead of the raw error", async () => {
    const { SkillsHubError } = await import("./api");
    api.remoteContent.mockRejectedValueOnce(
      new SkillsHubError("not_found", 'No SKILL.md for "gh-cli" in github/awesome-copilot'),
    );
    await renderPane();
    await openDetails();
    expect(document.body.textContent).toContain("This repository has no SKILL.md for this skill");
    expect(document.body.textContent).toContain("Open repository");
    // The backend's own text doesn't stand in for ours (not_found is explained instead).
    expect(document.body.textContent).not.toContain("No SKILL.md for");
  });

  it("installs from the detail dialog into the default engines", async () => {
    await renderPane();
    await openDetails();
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(buttonByText(dialog, "Install"));
    });
    expect(api.install).toHaveBeenCalledWith(popularSkill, ["claude", "codex"]);
    expect(buttonByText(screen.getByRole("dialog"), "Installed").disabled).toBe(true);
  });
});

function buttonByText(scope: HTMLElement, text: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}
