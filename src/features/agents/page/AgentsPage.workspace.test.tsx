import {
  composer,
  conversation,
  fixture,
  openAgentSettings,
  openChat,
  openPage,
  renderAgentsPage,
  typeDraft,
} from "./AgentsPage.testFixtures";
import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useMistyStore } from "@/features/agents/conversations/state/useMistyStore";

const nameField = () => screen.getByLabelText("Name") as HTMLInputElement;

it("opens straight into the agent's New task conversation without a directory", () => {
  renderAgentsPage();
  expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
  expect(screen.getByRole("heading", { name: "What can I do for you?" })).toBeTruthy();
  // The window's sidebar opens the other pages; the chat's bar has no page tabs.
  expect(screen.queryByRole("navigation", { name: "Agent workspace pages" })).toBeNull();
  expect(screen.getByRole("button", { name: "Switch agent: Communications" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to agents" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Agent settings" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Task" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show task panel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spaces" })).toBeNull();
});

it("offers agent settings and new agents from the switcher, not a directory", () => {
  renderAgentsPage();
  fireEvent.click(screen.getByRole("button", { name: "Switch agent: Communications" }));
  expect(screen.getByRole("button", { name: "Communications settings" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "New agent" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Browse all agents" })).toBeNull();
});

it("has no Details panel beside the conversation", () => {
  renderAgentsPage();
  expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
  expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
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

it("preserves one conversation draft across catalogs", () => {
  useMistyStore.setState({
    conversations: [conversation("launch", "Launch plan")],
    activeConversationId: "launch",
  });
  renderAgentsPage();
  const draft = composer();
  typeDraft("Keep this while I browse");
  openPage("integrations");
  expect(document.querySelector(".agent-studio")?.getAttribute("data-page")).toBe("integrations");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  openChat("communications", "launch");
  expect(composer()).toBe(draft);
  expect(draft.value).toBe("Keep this while I browse");
  expect(fixture.submit).not.toHaveBeenCalled();
});

it("opens the existing profile editor from the workspace and guards page changes", () => {
  renderAgentsPage();
  openAgentSettings();
  fireEvent.change(nameField(), { target: { value: "Unsaved identity" } });
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(nameField().value).toBe("Unsaved identity");
});

it("opens Integrations and Tutor from links, with no title bar", () => {
  renderAgentsPage("/agents?view=tutor");
  expect(screen.queryByRole("heading", { name: "Tutor", level: 1 })).toBeNull();
  expect(screen.getByRole("heading", { name: "Notebooks" })).toBeTruthy();
  const page = () => document.querySelector(".agent-studio")?.getAttribute("data-page");
  openPage("integrations");
  expect(page()).toBe("integrations");
  expect(document.querySelector(".agent-studio-bar")).toBeNull();
  openChat();
  expect(page()).toBe("task");
  expect(document.querySelector(".agent-studio-bar")).toBeTruthy();
  expect(composer()).toBeTruthy();
});
