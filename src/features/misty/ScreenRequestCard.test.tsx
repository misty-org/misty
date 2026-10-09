import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), decline: vi.fn() }));
vi.mock("./screenRequests", () => ({
  openScreenAndContinue: mocks.open,
  declineScreenRequest: mocks.decline,
  screenChoice: (location: string) => (location === "separate" ? "separate" : "window"),
}));
import { ScreenRequestCard } from "./ScreenRequestCard";
import { useMistyStore } from "./useMistyStore";

afterEach(() => {
  cleanup();
  mocks.open.mockClear();
});
const conversation = {
  id: "chat",
  title: "Chat",
  createdAt: "",
  updatedAt: "",
  remote: true,
  messages: [
    { id: "reply", role: "assistant" as const, mode: "ask" as const, content: "", createdAt: "" },
  ],
};

it("asks where to work only when the account asks each time", () => {
  useMistyStore.setState({ conversations: [conversation], working: false });
  render(
    <ScreenRequestCard
      messageId="reply"
      request={{ kind: "open", reason: "Read example.com", location: "ask", state: "pending" }}
    />,
  );
  expect(screen.getByText("Where should Misty work?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "New tab" }));
  expect(mocks.open).toHaveBeenCalledWith(
    useMistyStore.setState,
    useMistyStore.getState,
    "chat",
    "reply",
    "window",
  );
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(mocks.decline).toHaveBeenCalled();
});

it("shows progress without choices once the screen opens on its own", () => {
  useMistyStore.setState({ conversations: [conversation], working: true });
  render(
    <ScreenRequestCard
      messageId="reply"
      request={{ kind: "open", reason: "Read example.com", location: "separate", state: "opening" }}
    />,
  );
  expect(screen.getByText("Opening a screen…")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
