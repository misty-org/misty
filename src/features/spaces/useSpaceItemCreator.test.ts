import { renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSpaceItemCreator } from "./useSpaceItemCreator";

vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "me", name: "Alex" } }) }));
vi.mock("./store/useSpacesStore", () => ({
  useSpacesStore: (selector: (state: unknown) => unknown) =>
    selector({ membersBySpace: { family: [{ user_id: "sam", name: "Sam" }] } }),
}));
afterEach(cleanup);

it("resolves current and fellow members without guessing missing or agent identities", () => {
  const { result, rerender } = renderHook(({ spaceId }) => useSpaceItemCreator(spaceId), {
    initialProps: { spaceId: "family" },
  });
  expect(result.current("me")).toBe("Alex");
  expect(result.current("sam")).toBe("Sam");
  expect(result.current("removed")).toBe("Unknown member");
  expect(result.current()).toBe("Unknown");
  expect(result.current("me", "agent")).toBe("Agent");
  rerender({ spaceId: "other" });
  expect(result.current("sam")).toBe("Unknown member");
});
