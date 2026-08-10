import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

function packageJson(name: string): { license?: string } {
  let directory = dirname(require.resolve(name));

  while (directory !== dirname(directory)) {
    const packageJsonPath = join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
        license?: string;
      };
      if (packageJson.name === name) return packageJson;
    }
    directory = dirname(directory);
  }

  throw new Error(`Could not find package.json for ${name}`);
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
