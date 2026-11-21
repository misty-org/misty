import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const place = vi.hoisted(() => ({ current: "personal" as "personal" | "spaces" }));
vi.mock("./placeStore", () => ({
  usePlace: () => place.current,
  choosePlace: vi.fn(),
  useSpacesSideFollowsSpaces: () => undefined,
}));
vi.mock("./NavRail", () => ({ AccountAvatar: () => <span>Me</span> }));
vi.mock("@/features/account", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/features/direct", () => ({
  useDms: () => ({ data: [] }),
  useFriends: () => ({ data: { incoming: [] } }),
}));
vi.mock("@/features/spaces", () => ({
  useSpacesStore: {
    getState: () => ({
      spaces: [
        { id: "own", is_default: true },
        { id: "team", is_default: false },
      ],
    }),
  },
}));

import { PlaceToggle } from "./PlaceToggle";

afterEach(cleanup);

const message = (spaceId: string, mentioned: string, sender = "ana") =>
  window.dispatchEvent(
    new CustomEvent("misty:space-message-event", {
      detail: {
        spaceId,
        event: {
          type: "message.created",
          payload: { sender_user_id: sender, content: [{ type: "mention", user_id: mentioned }] },
        },
      },
    }),
  );

const dots = (container: HTMLElement) => container.querySelectorAll('[data-slot="indicator-dot"]').length;

it("marks Spaces after an @mention in a shared Space, never for Personal or someone else", () => {
  const { container } = render(<PlaceToggle />);
  expect(dots(container)).toBe(0);
  act(() => message("own", "me"));
  act(() => message("team", "someone-else"));
  act(() => message("team", "me", "me"));
  expect(dots(container)).toBe(0);
  act(() => message("team", "me"));
  expect(dots(container)).toBe(1);
});
