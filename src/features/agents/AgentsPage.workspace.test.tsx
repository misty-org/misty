import {
  chooseConversationAction,
  composer,
  conversation,
  fixture,
  openAgentSettings,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMistyStore } from "@/features/misty/useMistyStore";

const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;

it("opens straight into the agent's New task conversation without a directory", () => {
  renderAgentsPage();
  expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
  expect(screen.getByRole("heading", { name: "What can I do for you?" })).toBeTruthy();
  const pages = screen.getByRole("navigation", { name: "Agent workspace pages" });
  expect(within(pages).getByRole("button", { name: "Activity" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Switch agent: Communications" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to agents" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Agent settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Float conversation" })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Task panel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spaces" })).toBeNull();
});

it("offers agent settings and new agents from the switcher, not a directory", () => {
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  expect(screen.getByRole("option", { name: "Communications settings" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "New agent" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Browse all agents" })).toBeNull();
});

it("toggles the task panel without losing the conversation draft", () => {
  renderAgentsPage();
  typeDraft("Keep my draft");
  const toggle = screen.getByRole("button", { name: "Show task panel" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("complementary", { name: "Task panel" })).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("complementary", { name: "Task panel" })).toBeNull();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(composer().value).toBe("Keep my draft");
});

it("protects unsaved profile edits when closing settings while preserving the conversation draft", () => {
  renderAgentsPage();
  typeDraft("Unsent draft");
  openAgentSettings();
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

it("guards profile edits when toggling the task panel", () => {
  renderAgentsPage();
  openAgentSettings();
  fireEvent.change(nameField(), { target: { value: "Keep this name" } });
  const toggle = screen.getByRole("button", { name: "Show task panel" });
  fireEvent.click(toggle);
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Keep this name");
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

it("keeps the requested new task when discarding profile edits", () => {
  useMistyStore.setState({ activeConversationId: "earlier" });
  renderAgentsPage();
  openAgentSettings();
  fireEvent.change(nameField(), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(useMistyStore.getState().activeConversationId).toBe("");
  expect(composer().value).toBe("");
});

it("preserves one conversation draft across catalogs and floating presentation", async () => {
  useMistyStore.setState({
    conversations: [conversation("launch", "Launch plan")],
    activeConversationId: "launch",
  });
  renderAgentsPage();
  const draft = composer();
  typeDraft("Keep this while I browse");
  await chooseConversationAction("Launch plan", "Float conversation");
  expect(composer()).toBe(draft);
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  fireEvent.click(screen.getByRole("button", { name: "Return to full conversation" }));
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("requires draft-discard confirmation before filling a template, without submitting it", () => {
  renderAgentsPage();
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
  openAgentSettings();
  fireEvent.change(nameField(), { target: { value: "Unsaved identity" } });
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Unsaved identity");
});
