import { describe, expect, it } from "vitest";
import { agentCloudVariants } from "./agentCloudAvatars";

describe("bundled Misty mark transport", () => {
  it.each(agentCloudVariants)("embeds $name without a separate asset request", (variant) => {
    expect(variant.src).toMatch(/^data:image\/png;base64,/);
    const bytes = atob(variant.src.split(",")[1]);
    expect(Array.from(bytes.slice(0, 8), (byte) => byte.charCodeAt(0))).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
  });
});
