import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function packageJson(name: string): { license?: string } {
  return JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"));
}

describe("BlockNote beta licensing", () => {
  it("uses the commercial-friendly OSS BlockNote packages and avoids XL packages", () => {
    const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { license?: string }>;
    };
    const packages = Object.keys(lockfile.packages);

    expect(packages.filter((name) => name.includes("node_modules/@blocknote/xl-"))).toEqual([]);
    expect(packageJson("@blocknote/core").license).toBe("MPL-2.0");
    expect(packageJson("@blocknote/react").license).toBe("MPL-2.0");
    expect(packageJson("@blocknote/mantine").license).toBe("MPL-2.0");
    expect(packageJson("@blocknote/code-block").license).toBe("MPL-2.0");
    expect(packageJson("@shikijs/core").license).toBe("MIT");
  });
});
