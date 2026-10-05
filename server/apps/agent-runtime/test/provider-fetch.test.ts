import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from "@workflow/serde";
import { lookup } from "node:dns/promises";
import { providerFetch, publicProviderAddress } from "../src/provider-fetch.js";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("account provider transport", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "100.64.1.1",
    "192.0.2.1",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
    "fc00::1",
  ])("rejects private and reserved address %s", (address) => {
    expect(publicProviderAddress(address)).toBe(false);
  });
  it.each(["172.66.0.243", "162.159.140.245", "8.8.8.8", "2606:4700::6810:84e5"])(
    "accepts public address %s",
    (address) => {
      expect(publicProviderAddress(address)).toBe(true);
    },
  );
  it("rejects mixed public/private DNS before transmitting a credential", async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as never);
    await expect(
      providerFetch("https://provider.example/v1")("https://provider.example/v1/responses", {
        method: "POST",
        headers: { Authorization: "Bearer fixture" },
        body: "{}",
      }),
    ).rejects.toThrow("private or reserved");
  });
  it("rejects origin and path escapes before DNS or transmission", async () => {
    const fetch = providerFetch("https://provider.example/v1");
    await expect(fetch("https://elsewhere.example/v1/responses")).rejects.toThrow("target changed");
    await expect(fetch("https://provider.example/admin")).rejects.toThrow("target changed");
    expect(lookup).not.toHaveBeenCalled();
  });
  it("serializes only public run routing identity", async () => {
    const { InstanceModel } = await import("../src/instance-model.js");
    const identity = {
      mistyRunId: "run",
      runtimeRunId: "workflow",
      controlPlaneURL: "https://misty.example",
    };
    const model = new InstanceModel("openai/gpt-6-luna", identity, "vision");
    const value = InstanceModel[WORKFLOW_SERIALIZE](model);
    expect(value).toEqual({ modelId: model.modelId, identity, role: "vision" });
    expect(InstanceModel[WORKFLOW_DESERIALIZE](value).role).toBe("vision");
    expect(JSON.stringify(value)).not.toMatch(/apiKey|Authorization|secret/);
  });
});
