import { cleanup, render, screen, within } from "@testing-library/react";
import { Cpu, Gauge, Mic, Plus, Shield } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionBar, IconButton, MessageComposer, MessageComposerSend } from "@/shared/ui";

/**
 * Controls in one row share one height, and the space between any two of them is the same. The
 * UI rules stop features from resizing shared controls; this renders the shared rows themselves,
 * so a shared default that breaks the rule (a 24px send beside 32px chips) fails here.
 */

afterEach(cleanup);

const heightOf = (element: Element) =>
  element.className.split(/\s+/).find((token) => /^h-\d+$/.test(token));

function expectOneHeight(row: HTMLElement, height: string) {
  const buttons = within(row).getAllByRole("button");
  expect(buttons.length).toBeGreaterThan(1);
  for (const button of buttons) {
    expect([button.getAttribute("aria-label") ?? button.textContent, heightOf(button)]).toEqual([
      button.getAttribute("aria-label") ?? button.textContent,
      height,
    ]);
  }
}

describe("row heights", () => {
  it("gives every control in the composer's row the row's height, send included", () => {
    render(
      <MessageComposer
        inputProps={{ "aria-label": "Message", value: "", onChange: () => {} }}
        items={[
          { id: "attach", icon: Plus, label: "Attach", priority: 3, onSelect: () => {} },
          { id: "effort", icon: Gauge, label: "Medium", priority: 2, onSelect: () => {} },
          { id: "mode", icon: Shield, label: "Read only", priority: 2, onSelect: () => {} },
          { id: "model", icon: Cpu, label: "A model", priority: 1, shrink: true },
        ]}
        end={
          <>
            <IconButton label="Start voice input">
              <Mic />
            </IconButton>
            <MessageComposerSend label="Send" />
          </>
        }
      />,
    );
    expectOneHeight(screen.getByRole("toolbar", { name: "Message options" }), "h-8");
  });

  it.each([
    ["md", "h-8"],
    ["sm", "h-6"],
  ] as const)("keeps a %s action bar's controls at %s", (size, height) => {
    render(
      <ActionBar
        label="Bar"
        size={size}
        items={[
          { id: "one", icon: Plus, label: "Add", priority: 2, onSelect: () => {} },
          { id: "two", icon: Gauge, label: "Effort", priority: 1, onSelect: () => {} },
        ]}
        end={
          <IconButton label="Voice" size={size}>
            <Mic />
          </IconButton>
        }
      />,
    );
    expectOneHeight(screen.getByRole("toolbar", { name: "Bar" }), height);
  });

  it("gives every control in a bar the same inner padding", () => {
    render(<ActionBar label="Bar" items={[]} />);
    expect(screen.getByRole("toolbar", { name: "Bar" }).className).toContain(
      "[&_button[data-slot=button]]:px-2",
    );
  });
});
