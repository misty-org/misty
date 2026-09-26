import { expect, it } from "vitest";
import { deviceLabels } from "./deviceNames";

const device = (id: string, platform: string, created: string, name = "") => ({
  device_id: id,
  display_name: name,
  platform,
  created_at: created,
  control_version: 1,
  full_sync: true,
});

it("numbers unnamed devices per kind in enrollment order and keeps chosen names", () => {
  const labels = deviceLabels(
    [
      device("z", "macos", "2026-09-02"),
      device("a", "macos", "2026-09-01"),
      device("p", "windows", "2026-09-03"),
      device("n", "macos", "2026-09-04", "Studio"),
    ],
    "Matthew Tran",
  );
  expect(labels.get("a")).toBe("Matthew’s Mac 1");
  expect(labels.get("z")).toBe("Matthew’s Mac 2");
  expect(labels.get("p")).toBe("Matthew’s PC");
  expect(labels.get("n")).toBe("Studio");
  expect(deviceLabels([device("x", "linux", "")], null).get("x")).toBe("My Linux PC");
});
