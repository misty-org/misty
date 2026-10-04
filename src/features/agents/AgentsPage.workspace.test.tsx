import {
  composer,
  fixture,
  openCommunications,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMistyStore } from "@/features/misty/useMistyStore";

const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;

it("keeps the directory and opens a selected agent's launch workspace", () => {
  renderAgentsPage();
  expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Agent workspace pages" })).toBeNull();
  openCommunications();
  expect(screen.getByRole("heading", { name: "What can I do for you?" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Agent workspace pages" })).toBeTruthy();
  expect(screen.queryByRole("complementary", { name: "Agent panel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spaces" })).toBeNull();
});

it("toggles the agent panel without losing the conversation draft", () => {
  renderAgentsPage();
  openCommunications();
  typeDraft("Keep my draft");
  const toggle = screen.getByRole("button", { name: "Show agent panel" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("complementary", { name: "Agent panel" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("complementary", { name: "Agent panel" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(composer().value).toBe("Keep my draft");
});

it("protects unsaved profile edits when closing settings while preserving the conversation draft", () => {
  renderAgentsPage();
  openCommunications();
  typeDraft("Unsent draft");
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  fireEvent.change(nameField(), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Unsaved name");
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(composer().value).toBe("Unsent draft");
});

it("guards profile edits when toggling the agent panel", () => {
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  fireEvent.change(nameField(), { target: { value: "Keep this name" } });
  const toggle = screen.getByRole("button", { name: "Show agent panel" });
  fireEvent.click(toggle);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Keep this name");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

it("keeps the requested new task when discarding profile edits", () => {
  useMistyStore.setState({ activeConversationId: "earlier" });
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  fireEvent.change(nameField(), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(useMistyStore.getState().activeConversationId).toBe("");
  expect(composer().value).toBe("");
});

it("preserves one conversation draft across catalogs and floating presentation", () => {
  renderAgentsPage();
  openCommunications();
  const draft = composer();
  typeDraft("Keep this while I browse");
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Float conversation" }));
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  fireEvent.click(screen.getByRole("button", { name: "Return to full conversation" }));
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("requires draft-discard confirmation before filling a template, without submitting it", () => {
  renderAgentsPage();
  openCommunications();
  typeDraft("Original draft");
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  const template = () =>
    screen.getByRole("button", { name: /Research a topic and build a useful report/ });
  fireEvent.click(template());
  fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(composer().value).toBe("Original draft");
  fireEvent.click(template());
  fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(composer().value).toContain("Research a topic");
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("opens a reusable workflow editor without starting work", () => {
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
  fireEvent.click(screen.getByRole("button", { name: "New workflow" }));
  fireEvent.change(nameField(), { target: { value: "My research workflow" } });
  fireEvent.change(screen.getByLabelText("Instructions"), {
    target: { value: "Research the chosen topic." },
  });
  expect(screen.getByRole("button", { name: "Save workflow" }).hasAttribute("disabled")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fixture.save).not.toHaveBeenCalled();
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("opens the existing profile editor from the workspace and guards catalog navigation", () => {
  renderAgentsPage();
  openCommunications();
  fireEvent.click(screen.getByRole("button", { name: "Agent settings" }));
  fireEvent.change(nameField(), { target: { value: "Unsaved identity" } });
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Unsaved identity");
});
