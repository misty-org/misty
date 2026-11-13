import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArrowRight, Plus, X } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../overlays/Tooltip";
import { BackButton } from "./BackButton";
import { Button } from "./Button";
import { DragHandleButton } from "./DragHandleButton";
import { IconButton } from "./IconButton";

afterEach(cleanup);

// Tooltips open on hover and on keyboard focus; jsdom has no keyboard focus, so tests hover.
function hover(element: HTMLElement) {
  act(() => {
    fireEvent.pointerMove(element, { pointerType: "mouse" });
  });
}

describe("Button", () => {
  it("is a 32px secondary button at the control type size by default", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.dataset.variant).toBe("secondary");
    expect(button.dataset.size).toBe("md");
    expect(button.className).toContain("h-8");
    expect(button.className).toContain("text-control");
    expect(button.className).toContain("border-charcoal-border-strong");
  });

  it("draws each role and size", () => {
    render(
      <>
        <Button variant="primary" size="lg">
          Sign in
        </Button>
        <Button variant="quiet" size="sm">
          Skip
        </Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    const primary = screen.getByRole("button", { name: "Sign in" });
    expect(primary.className).toContain("bg-cream-bright");
    expect(primary.className).toContain("h-9");
    const quiet = screen.getByRole("button", { name: "Skip" });
    expect(quiet.className).toContain("h-6");
    expect(quiet.className).toContain("text-cream-muted");
    expect(quiet.className).toContain("text-control");
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("text-danger");
  });

  it("draws icons on either side of the label", () => {
    render(
      <Button icon={Plus} iconEnd={<ArrowRight />}>
        New chat
      </Button>,
    );
    const button = screen.getByRole("button", { name: "New chat" });
    expect(button.querySelector('[data-icon="inline-start"]')?.tagName.toLowerCase()).toBe("svg");
    expect(button.querySelector('[data-icon="inline-end"]')).not.toBeNull();
  });

  it("swaps the icon for a spinner while loading, keeps the label and holds clicks", () => {
    const onClick = vi.fn();
    render(
      <Button icon={Plus} loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("styles its child with asChild and keeps the icon inside it", () => {
    render(
      <Button asChild icon={Plus}>
        <a href="/new">Open</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Open" });
    expect(link.dataset.slot).toBe("button");
    expect(link.querySelector('[data-icon="inline-start"]')).not.toBeNull();
  });

  it("goes back with a quiet button", () => {
    render(<BackButton />);
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.dataset.variant).toBe("quiet");
    expect(back.querySelector('[data-icon="inline-start"]')).not.toBeNull();
  });
});

describe("IconButton", () => {
  it("names itself with a tooltip, never the system title", async () => {
    render(
      <TooltipProvider>
        <IconButton label="Close tab">
          <X />
        </IconButton>
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Close tab" });
    expect(button.hasAttribute("title")).toBe(false);
    expect([button.dataset.variant, button.dataset.size]).toEqual(["quiet", "md"]);
    hover(button);
    expect((await screen.findByRole("tooltip")).textContent).toBe("Close tab");
  });

  it("says more in its tooltip with a hint, keeping the label as its name", async () => {
    render(
      <TooltipProvider>
        <IconButton label="Check the server" hint="Starts the server, then stops it.">
          <Plus />
        </IconButton>
      </TooltipProvider>,
    );
    hover(screen.getByRole("button", { name: "Check the server" }));
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Starts the server, then stops it.",
    );
  });

  it("shows the shortcut after the label only while hints are on", async () => {
    const { unmount } = render(
      <TooltipProvider>
        <IconButton label="New chat" shortcut="⌘N">
          <Plus />
        </IconButton>
      </TooltipProvider>,
    );
    hover(screen.getByRole("button", { name: "New chat" }));
    await screen.findByRole("tooltip");
    expect(document.querySelector('[data-slot="tooltip-shortcut"]')?.textContent).toBe("⌘N");
    unmount();

    render(
      <TooltipProvider shortcutHints={false}>
        <IconButton label="New chat" shortcut="⌘N">
          <Plus />
        </IconButton>
      </TooltipProvider>,
    );
    hover(screen.getByRole("button", { name: "New chat" }));
    await screen.findByRole("tooltip");
    expect(document.querySelector('[data-slot="tooltip-shortcut"]')).toBeNull();
  });

  it("doesn't pop up when focus comes back from a closing menu", async () => {
    render(
      <IconButton label="More">
        <Plus />
      </IconButton>,
    );
    // jsdom never matches :focus-visible, like focus handed back after a click.
    act(() => screen.getByRole("button", { name: "More" }).focus());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("draws at 24 or 32px", () => {
    render(
      <>
        <IconButton label="Small" size="sm">
          <X />
        </IconButton>
        <IconButton label="Default">
          <X />
        </IconButton>
      </>,
    );
    const small = screen.getByRole("button", { name: "Small" });
    expect([small.dataset.size, small.className.includes("w-6")]).toEqual(["sm", true]);
    expect(small.className).toContain("p-0");
    expect(screen.getByRole("button", { name: "Default" }).dataset.size).toBe("md");
  });

  it("lets a drag handle keep text selection so WebKit can drag it", () => {
    render(
      <DragHandleButton label="Move block">
        <Plus />
      </DragHandleButton>,
    );
    const handle = screen.getByRole("button", { name: "Move block" });
    expect(handle.dataset.slot).toBe("drag-handle-button");
    expect(handle.className).toContain("select-auto");
    expect(handle.className).not.toContain("select-none");
  });
});

describe("Button type", () => {
  it("is a plain button by default, so a click inside a form never submits it", () => {
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Button>Add</Button>
        <IconButton label="Remove">
          <X />
        </IconButton>
        <Button type="submit">Save</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Add" }).getAttribute("type")).toBe("button");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("leaves a link styled with asChild without a type", () => {
    render(
      <Button asChild>
        <a href="#home">Home</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Home" }).hasAttribute("type")).toBe(false);
  });
});
