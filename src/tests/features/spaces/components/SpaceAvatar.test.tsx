import { describe, expect, it } from "vitest";
import { spaceInitials } from "@/features/spaces/components/SpaceAvatar";

describe("spaceInitials", () => {
  it("creates compact default profile-picture initials", () => {
    expect(spaceInitials("Design team")).toBe("DT");
    expect(spaceInitials("Misty")).toBe("MI");
    expect(spaceInitials("  ")).toBe("S");
  });
});
