import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentCloudVariants } from "./agent_cloud_avatars";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const bytesOf = (source: string) =>
  readFileSync(resolve(repositoryRoot, source.replace(/^\//, ""))).toString("latin1");

describe("bundled cloud sprites", () => {
  it.each(agentCloudVariants)(
    "ships the $name animation and its reduced-motion poster as files of their own",
    (variant) => {
      for (const source of [variant.src, variant.poster]) {
        expect(source).not.toMatch(/^data:/);
        const bytes = bytesOf(source);
        expect(bytes.slice(0, 4)).toBe("RIFF");
        expect(bytes.slice(8, 12)).toBe("WEBP");
      }
      expect(bytesOf(variant.src)).toContain("ANIM");
      expect(bytesOf(variant.poster)).not.toContain("ANIM");
    },
  );
});
