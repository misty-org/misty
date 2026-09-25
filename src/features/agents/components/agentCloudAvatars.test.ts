import { describe, expect, it } from "vitest";
import { agentCloudVariants } from "./agentCloudAvatars";
describe("bundled cloud sprite transport", () => {
  it.each(agentCloudVariants)(
    "embeds $name animation and reduced-motion poster without a separate asset request",
    (variant) => {
      for (const source of [variant.src, variant.poster]) {
        expect(source).toMatch(/^data:image\/webp;base64,/);
        const bytes = atob(source.split(",")[1]);
        expect(bytes.slice(0, 4)).toBe("RIFF");
        expect(bytes.slice(8, 12)).toBe("WEBP");
      }
      expect(atob(variant.src.split(",")[1])).toContain("ANIM");
      expect(atob(variant.poster.split(",")[1])).not.toContain("ANIM");
    },
  );
});
