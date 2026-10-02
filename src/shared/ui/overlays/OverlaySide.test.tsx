import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OverlaySideProvider, inwardSide } from "./OverlaySide";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";
afterEach(cleanup);
it.each(["left", "right", "top", "bottom"] as const)(
  "opens both kinds of portaled overlay toward the workspace from %s",
  async (edge) => {
    render(
      <OverlaySideProvider value={inwardSide[edge]}>
        <Popover open>
          <PopoverTrigger>Sync</PopoverTrigger>
          <PopoverContent avoidCollisions={false} aria-label="Sync">
            Status
          </PopoverContent>
        </Popover>
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Profile</DropdownMenuTrigger>
          <DropdownMenuContent avoidCollisions={false} aria-label="Profile">
            <DropdownMenuItem>Account</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </OverlaySideProvider>,
    );
    expect((await screen.findByRole("dialog", { name: "Sync" })).getAttribute("data-side")).toBe(
      inwardSide[edge],
    );
    expect((await screen.findByRole("menu", { name: "Profile" })).getAttribute("data-side")).toBe(
      inwardSide[edge],
    );
  },
);
it("allows titlebar controls to override the tab strip's side", async () => {
  render(
    <OverlaySideProvider value="left">
      <Popover open>
        <PopoverTrigger>Windows</PopoverTrigger>
        <PopoverContent side="bottom" avoidCollisions={false}>
          Windows
        </PopoverContent>
      </Popover>
    </OverlaySideProvider>,
  );
  expect((await screen.findByRole("dialog")).getAttribute("data-side")).toBe("bottom");
});
