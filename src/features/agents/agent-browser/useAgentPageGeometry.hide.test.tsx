import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentPageGeometry } from "./useAgentPageGeometry";

const browser = vi.hoisted(() => ({
  hideAdoptedBrowserPage: vi.fn((_id: string, _grace?: number) => Promise.resolve()),
  showAdoptedBrowserPage: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/features/browser", () => ({
  ...browser,
  visibleBrowserBounds: () => ({ x: 0, y: 0, width: 400, height: 300 }),
  requestBrowserWebviewLayoutByRuntimeId: vi.fn(),
}));
vi.mock("@/features/app-windows", () => ({
  browserRuntimeResumeEvent: "misty:test-resume",
  isBrowserLayoutMoving: () => false,
  onBrowserSettled: () => () => undefined,
}));

function Stage(props: { viewId: string; handoff?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useAgentPageGeometry(host, props.viewId, { handoff: props.handoff });
  return <div ref={host} />;
}

/** The grace the page with this id was last hidden with. */
const graceOf = (id: string) => {
  const calls = browser.hideAdoptedBrowserPage.mock.calls.filter(([hidden]) => hidden === id);
  return calls[calls.length - 1]?.[1];
};

const settle = () => act(async () => await Promise.resolve());

afterEach(() => vi.clearAllMocks());

describe("taking an agent's page off screen", () => {
  it("hides it at once when the person goes to another page", async () => {
    const { container, rerender } = render(<Stage viewId="page-1" />);
    // The view is kept beneath the next one, and the panel lets go of its page.
    container.setAttribute("data-tab-kept", "");
    rerender(<Stage viewId="" />);
    await settle();
    expect(graceOf("page-1")).toBe(0);
  });

  it("hides it at once when its host goes, even in the agent browser", async () => {
    const { unmount } = render(<Stage viewId="page-1" handoff />);
    unmount();
    await settle();
    expect(graceOf("page-1")).toBe(0);
  });

  it("hides it at once when the agent browser is hidden by navigation", async () => {
    const { container, rerender } = render(<Stage viewId="page-1" handoff />);
    container.hidden = true;
    rerender(<Stage viewId="page-2" handoff />);
    await settle();
    expect(graceOf("page-1")).toBe(0);
  });

  it("keeps it up for the next tab while the agent browser switches tabs", async () => {
    const { rerender } = render(<Stage viewId="page-1" handoff />);
    rerender(<Stage viewId="page-2" handoff />);
    await settle();
    expect(graceOf("page-1")).toBe(120);
  });
});
