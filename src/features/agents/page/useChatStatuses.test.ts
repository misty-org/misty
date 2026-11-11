import { expect, it } from "vitest";
import { chatStatusOf, shortAgo } from "./useChatStatuses";

it("reads a run's state as what its chat row shows", () => {
  expect(chatStatusOf("running")).toBe("working");
  expect(chatStatusOf("queued")).toBe("working");
  expect(chatStatusOf("awaiting_approval")).toBe("needs-you");
  expect(chatStatusOf("failed")).toBe("failed");
  expect(chatStatusOf("completed")).toBe("done");
});

it("says how long ago in as few characters as it can", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  expect(shortAgo("2026-11-11T11:59:40Z", now)).toBe("now");
  expect(shortAgo("2026-11-11T11:55:00Z", now)).toBe("5m");
  expect(shortAgo("2026-11-11T09:00:00Z", now)).toBe("3h");
  expect(shortAgo("2026-11-09T12:00:00Z", now)).toBe("2d");
  expect(shortAgo("not a date", now)).toBe("");
});
