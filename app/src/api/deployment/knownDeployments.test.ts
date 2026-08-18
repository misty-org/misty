import { describe, expect, it } from "vitest";
import {
  deploymentHostLabel,
  forgetDeployment,
  readKnownDeployments,
  rememberDeployment,
} from "./knownDeployments";

function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const alpha = { url: "https://alpha.example.com/api", serverId: "alpha", name: "Alpha" };
const beta = { url: "https://beta.example.com/api", serverId: "beta", name: "Beta" };

describe("known deployments", () => {
  it("starts empty and round-trips a server", () => {
    const target = storage();
    expect(readKnownDeployments(target)).toEqual([]);
    rememberDeployment(alpha, target);
    expect(readKnownDeployments(target)).toEqual([alpha]);
  });

  it("moves an already-known server back to the front without duplicating it", () => {
    const target = storage();
    rememberDeployment(alpha, target);
    rememberDeployment(beta, target);
    expect(readKnownDeployments(target).map((entry) => entry.url)).toEqual([beta.url, alpha.url]);
    rememberDeployment({ ...alpha, name: "Alpha renamed" }, target);
    expect(readKnownDeployments(target)).toEqual([{ ...alpha, name: "Alpha renamed" }, beta]);
  });

  it("keeps at most eight servers", () => {
    const target = storage();
    for (let index = 0; index < 12; index += 1) {
      rememberDeployment(
        { url: `https://s${index}.example.com/api`, serverId: `s${index}`, name: `S${index}` },
        target,
      );
    }
    const stored = readKnownDeployments(target);
    expect(stored).toHaveLength(8);
    expect(stored[0].url).toBe("https://s11.example.com/api");
  });

  it("drops a forgotten server", () => {
    const target = storage();
    rememberDeployment(alpha, target);
    rememberDeployment(beta, target);
    expect(forgetDeployment(alpha.url, target)).toEqual([beta]);
    expect(readKnownDeployments(target)).toEqual([beta]);
  });

  it("survives corrupt or non-conforming stored values", () => {
    expect(readKnownDeployments(storage({ "misty:known-deployments:v1": "{{" }))).toEqual([]);
    expect(readKnownDeployments(storage({ "misty:known-deployments:v1": '{"url":"x"}' }))).toEqual(
      [],
    );
    expect(
      readKnownDeployments(storage({ "misty:known-deployments:v1": '[{"serverId":"x"}]' })),
    ).toEqual([]);
  });

  it("ignores an entry with no URL", () => {
    const target = storage();
    rememberDeployment({ url: "", serverId: null, name: "Nowhere" }, target);
    expect(readKnownDeployments(target)).toEqual([]);
  });

  it("labels a server by host, falling back to the raw value", () => {
    expect(deploymentHostLabel("https://misty.example.com:8443/api")).toBe(
      "misty.example.com:8443",
    );
    expect(deploymentHostLabel("not a url")).toBe("not a url");
  });
});
