import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  codeNewProject: vi.fn(async () => ({ id: "scope_new", displayName: "bakery" })),
  codeCloneProject: vi.fn(async () => ({ id: "scope_clone", displayName: "site" })),
  codeRemoveProject: vi.fn(async () => undefined),
}));
const git = vi.hoisted(() => ({
  githubRepos: vi.fn(async () => [
    { owner: "kannachi323", name: "site", private: true, defaultBranch: "main", canPush: true },
    { owner: "kannachi323", name: "notes", private: false, defaultBranch: "trunk", canPush: true },
  ]),
  cloneInto: vi.fn(async () => ({ state: "updated", branch: "main" })),
}));
vi.mock("../store/useAgentsStore", () => store);
vi.mock("../git/projectGit", () => ({
  githubRepos: git.githubRepos,
  projectGit: (id: string) => ({ id }),
}));
vi.mock("../git/gitSync", () => ({ cloneInto: git.cloneInto }));

import { FromGitHubDialog, NewProjectDialog } from "./ProjectDialogs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("creates a new project with the name given", async () => {
  const created = vi.fn();
  render(<NewProjectDialog open onOpenChange={vi.fn()} onCreated={created} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "bakery" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose where to create it" }));
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({ id: "scope_new", displayName: "bakery" }),
  );
  expect(store.codeNewProject).toHaveBeenCalledWith("bakery");
});

it("clones a repository from GitHub into a new project", async () => {
  const created = vi.fn();
  render(<FromGitHubDialog open onOpenChange={vi.fn()} onCreated={created} />);
  fireEvent.change(await screen.findByLabelText("Search repositories"), {
    target: { value: "not" },
  });
  expect(screen.queryByText("kannachi323/site")).toBeNull();
  fireEvent.click(screen.getByText("kannachi323/notes"));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(store.codeCloneProject).toHaveBeenCalledWith("kannachi323", "notes", "trunk");
  expect(git.cloneInto).toHaveBeenCalledWith(
    { id: "scope_clone" },
    expect.objectContaining({ name: "notes" }),
    "trunk",
  );
});

it("removes the half-made project when cloning fails", async () => {
  git.cloneInto.mockRejectedValueOnce(new Error("GitHub: Not Found"));
  render(<FromGitHubDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.click(await screen.findByText("kannachi323/site"));
  expect(await screen.findByText("GitHub: Not Found")).toBeTruthy();
  expect(store.codeRemoveProject).toHaveBeenCalledWith("scope_clone");
});
