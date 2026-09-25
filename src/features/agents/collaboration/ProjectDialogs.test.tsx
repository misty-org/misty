import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  newProject: vi.fn(async () => ({ id: "scope_new", displayName: "bakery" })),
}));
vi.mock("../store/useAgentsStore", () => store);

import { NewProjectDialog } from "./ProjectDialogs";

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
  expect(store.newProject).toHaveBeenCalledWith("bakery");
});

it("explains a failure in plain words", async () => {
  store.newProject.mockRejectedValueOnce(
    "bakery already exists there. Pick another name or place.",
  );
  render(<NewProjectDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "bakery" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose where to create it" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/already exists/);
});
