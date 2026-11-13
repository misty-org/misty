import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Space } from "../../api/dto/entities";

const spaces: Space[] = [];
vi.mock("../../list/useSpacesStore", () => ({
  useSpacesStore: (selector: (state: { spaces: Space[] }) => unknown) => selector({ spaces }),
}));
vi.mock("@/features/app-windows", async (original) => ({
  ...(await original<object>()),
  switchSpaceWindow: vi.fn(),
}));

import { DropdownMenu, DropdownMenuContent } from "@/shared/ui";
import { SpaceMenuItems, SpaceSettingsItems } from "./SpaceMenuItems";

afterEach(cleanup);

function space(patch: Partial<Space>): Space {
  return {
    id: "space",
    is_default: false,
    owner_user_id: "me",
    name: "Space",
    role: "owner",
    member_count: 1,
    pending_count: 0,
    is_shared: false,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...patch,
  };
}

function open(children: ReactNode) {
  render(
    <DropdownMenu open>
      <DropdownMenuContent>{children}</DropdownMenuContent>
    </DropdownMenu>,
  );
}

const own = space({ id: "own", name: "Personal", is_default: true });
const team = space({ id: "team", name: "Team" });
const theirs = space({ id: "theirs", name: "Theirs", role: "member", owner_user_id: "them" });

it("lists the person's own Space first in the switcher", () => {
  spaces.splice(0, spaces.length, team, theirs, own);
  open(<SpaceMenuItems space={team} onDialog={vi.fn()} onCreate={vi.fn()} />);
  // Each row's text is its avatar's initials, then its name.
  const rows = screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent ?? "");
  expect(rows.map((text, index) => text.endsWith(["Personal", "Team", "Theirs"][index]!))).toEqual([
    true,
    true,
    true,
  ]);
});

it("never offers to delete, leave or transfer the person's own Space", () => {
  spaces.splice(0, spaces.length, own, team);
  open(<SpaceSettingsItems space={own} onDialog={vi.fn()} />);
  expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: /Leave/ })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
});

it("offers Delete for another Space its owner made", () => {
  spaces.splice(0, spaces.length, own, team);
  open(<SpaceSettingsItems space={team} onDialog={vi.fn()} />);
  expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeTruthy();
});
