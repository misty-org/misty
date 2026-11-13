import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChoiceGroup } from "../controls/ChoiceGroup";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogTitle,
} from "../overlays/AlertDialog";
import { Avatar, AvatarFallback } from "./Avatar";
import { CodeBlock } from "./CodeBlock";
import { Kbd, asKbd } from "./Kbd";
import { Text } from "./Text";

afterEach(cleanup);

describe("CodeBlock", () => {
  it("shows the code in the code font with a copy button", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code="npm install" />);
    const pre = screen.getByText("npm install").closest("pre")!;
    expect(pre.className).toContain("font-mono");
    expect(pre.className).toContain("overflow-x-auto");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("npm install");
  });

  it("wraps long lines when asked and can leave out the copy button", () => {
    render(<CodeBlock code="echo hi" wrap copy={false} />);
    expect(screen.getByText("echo hi").closest("pre")!.className).toContain("whitespace-pre-wrap");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Kbd", () => {
  it("is a keycap, and a shortcut slot turns only strings into one", () => {
    render(
      <>
        <Kbd>⌘K</Kbd>
        {asKbd("⇧⌘T")}
        {asKbd(<span data-testid="own">custom</span>)}
      </>,
    );
    expect(screen.getByText("⌘K").tagName).toBe("KBD");
    expect(screen.getByText("⇧⌘T").tagName).toBe("KBD");
    expect(screen.getByTestId("own").tagName).toBe("SPAN");
  });
});

describe("Text", () => {
  it("wraps as a paragraph with no fade, and has a display role", () => {
    render(
      <>
        <Text size="body" tone="muted" wrap>
          A long description
        </Text>
        <Text size="display">42</Text>
      </>,
    );
    const paragraph = screen.getByText("A long description");
    expect(paragraph.tagName).toBe("P");
    expect(paragraph.className).toContain("whitespace-normal");
    expect(paragraph.className).not.toContain("whitespace-nowrap");
    expect(paragraph.className).toContain("text-cream-muted");
    expect(screen.getByText("42").className).toContain("text-display");
  });
});

describe("Avatar", () => {
  it("takes the 16 and 64 sizes and a tone for its initials", () => {
    render(
      <>
        <Avatar size="xs" data-testid="small" />
        <Avatar size="xl" shape="tile" tone="teal" data-testid="tile">
          <AvatarFallback>DS</AvatarFallback>
        </Avatar>
      </>,
    );
    expect(screen.getByTestId("small").className).toContain("data-[size=xs]:size-4");
    const tile = screen.getByTestId("tile");
    expect(tile.dataset.tone).toBe("teal");
    expect(tile.className).toContain("data-[size=xl]:size-16");
    expect(screen.getByText("DS").className).toContain(
      "group-data-[tone=teal]/avatar:bg-tone-teal",
    );
  });
});

describe("ChoiceGroup shortcut", () => {
  it("gives a text option with a shortcut a tooltip", () => {
    render(
      <ChoiceGroup
        label="View"
        value="month"
        onChange={() => {}}
        options={[
          { value: "month", label: "Month", shortcut: "⌘1" },
          { value: "agenda", label: "Agenda" },
        ]}
      />,
    );
    // Radix tooltip triggers carry data-state; a plain option has none.
    expect(screen.getByRole("radio", { name: "Month" }).dataset.state).toBeDefined();
  });
});

describe("AlertDialogAction", () => {
  it("passes loading to its button", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogTitle>Leave the Space?</AlertDialogTitle>
          <AlertDialogAction loading>Leave</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const action = screen.getByRole("button", { name: "Leave" });
    expect(action.dataset.loading).toBe("true");
    expect(action.getAttribute("aria-busy")).toBe("true");
  });
});
