import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const repo = {
  owner: "ana",
  name: "site",
  private: true,
  defaultBranch: "main",
  url: "https://github.com/ana/site",
  cloneUrl: "https://github.com/ana/site.git",
};
const github = vi.hoisted(() => ({
  githubRepos: vi.fn(),
  createGitHubRepo: vi.fn(),
  publishProject: vi.fn(),
  cloneProject: vi.fn(),
  projectRemote: vi.fn(),
}));
vi.mock("../store/projectGitHub", () => github);
vi.mock("../store/useAgentsStore", () => ({ newProject: vi.fn() }));

import { FromGitHubDialog, PublishDialog, repositoryName } from "./GitHubDialogs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("clones a chosen repository into a new project", async () => {
  github.githubRepos.mockResolvedValue([repo, { ...repo, name: "docs", private: false }]);
  github.cloneProject.mockResolvedValue({ id: "scope_site", displayName: "site" });
  const created = vi.fn();
  render(<FromGitHubDialog open onOpenChange={vi.fn()} onCreated={created} />);
  await screen.findByText("ana/docs");
  fireEvent.change(screen.getByLabelText("Search repositories"), { target: { value: "sit" } });
  expect(screen.queryByText("ana/docs")).toBeNull();
  fireEvent.click(screen.getByText("ana/site"));
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith({ id: "scope_site", displayName: "site" }),
  );
  expect(github.cloneProject).toHaveBeenCalledWith(repo);
});

it("says to connect GitHub when it isn't connected", async () => {
  github.githubRepos.mockRejectedValue(new Error("Connect GitHub in Agents › Integrations first."));
  render(<FromGitHubDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Connect GitHub in Agents › Integrations first.",
  );
});

it("retries a failed push to the repository it already made", async () => {
  github.createGitHubRepo.mockResolvedValue(repo);
  github.publishProject
    .mockRejectedValueOnce(
      "Git couldn't sign in to GitHub. Sign in with `gh auth login`, then try again.",
    )
    .mockResolvedValueOnce(undefined);
  const published = vi.fn();
  render(
    <PublishDialog
      open
      scopeId="scope_site"
      suggestedName="My Site!"
      onOpenChange={vi.fn()}
      onPublished={published}
    />,
  );
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("My-Site");
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /sign in to GitHub.*Publish again to retry the push to ana\/site\./,
  );
  fireEvent.click(screen.getByRole("button", { name: "Publish" }));
  await waitFor(() => expect(published).toHaveBeenCalledWith("ana/site"));
  expect(github.createGitHubRepo).toHaveBeenCalledTimes(1);
  expect(github.publishProject).toHaveBeenCalledTimes(2);
});

it("turns a folder name into a repository name", () => {
  expect(repositoryName("  bakery site/v2 ")).toBe("bakery-site-v2");
  expect(repositoryName("..hidden")).toBe("hidden");
});
