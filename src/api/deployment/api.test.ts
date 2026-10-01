import { beforeEach, describe, expect, it } from "vitest";
import {
  deploymentStorageKey,
  readDeploymentScope,
  readDeploymentStorageItem,
  resolveHostedApiBase,
} from "@/api/deployment/api";

describe("hosted deployment routing", () => {
  beforeEach(() => localStorage.clear());

  it("uses the loopback Go API for ordinary desktop development", () => {
    expect(resolveHostedApiBase()).toBe("http://127.0.0.1:8081/v1");
  });

  it("namespaces local state under the Hosted scope", () => {
    expect(readDeploymentScope()).toBe("hosted");
    expect(deploymentStorageKey("misty:example")).toBe("misty:example:hosted");
  });

  it("falls back to state written before namespacing", () => {
    localStorage.setItem("misty:example", "legacy");
    expect(readDeploymentStorageItem("misty:example")).toBe("legacy");
    localStorage.setItem("misty:example:hosted", "current");
    expect(readDeploymentStorageItem("misty:example")).toBe("current");
  });
});
