import { beforeEach, describe, expect, it } from "vitest";
import {
  call,
  failure,
  grant,
  lastJob,
  mocks,
  resetDeviceTools,
  scope,
  start,
  tab,
  workspace,
} from "./deviceTools.testFixtures";
import type { LocalToolRejected } from "./host";
import { loadRunEntry } from "./runContexts";

beforeEach(resetDeviceTools);

describe("addresses", () => {
  it("corrects an address with no such host before anything opens", async () => {
    await start();
    mocks.missing.mockResolvedValue(true);
    const error = await failure(
      call("browser.navigate", { scopeId: scope, url: "https://jjs-house.com/x" }),
    );
    expect(error.message).toContain("jjs-house.com does not exist");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("doesn't look up an address or a local name, and a failed lookup lets it load", async () => {
    await start();
    await call("browser.navigate", { scopeId: scope, url: "http://192.168.1.2/" });
    await call("browser.navigate", { scopeId: scope, url: "http://printer.local/" });
    expect(mocks.missing).not.toHaveBeenCalled();
    mocks.missing.mockRejectedValue(new Error("no"));
    await call("browser.navigate", { scopeId: scope, url: "https://a.co/" });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
});

describe("browser.extract", () => {
  const input = { scopeId: scope, instruction: "links", schema: { type: "object" } };

  it("checks the request before reading the page", async () => {
    await start();
    const error = await failure(call("browser.extract", { ...input, schema: { type: "array" } }));
    expect(error.message).toContain("whose top level has type object");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("corrects links against the page", async () => {
    await start();
    mocks.execute.mockResolvedValue({
      url: "https://shop.example/seller",
      title: "Seller",
      markdown: "[one](/items/abcdef-listing-one) and [two](https://shop.example/items/two)",
      truncated: false,
      data: {
        near: "https://shop.example/items/abcdef-listing-0ne",
        made: "https://elsewhere.example/made-up",
        kept: "/items/two",
      },
    });
    await expect(call("browser.extract", input)).resolves.toEqual({
      data: {
        near: "https://shop.example/items/abcdef-listing-one",
        made: "",
        kept: "https://shop.example/items/two",
      },
      url: "https://shop.example/seller",
      title: "Seller",
      pageTruncated: false,
      contentTrust: "untrusted-web-page",
      linksCorrected: 1,
      linksRemoved: ["https://elsewhere.example/made-up"],
      note: "Links the page does not hold were removed; open listings by clicking them on the page.",
    });
  });

  it("counts a read with no extraction as a failed look", async () => {
    await start();
    mocks.execute.mockResolvedValue({ url: "https://a.co", markdown: "text" });
    const error = await failure(call("browser.extract", input));
    expect((error as LocalToolRejected).code).toBe("browser_observation_failed");
  });
});

describe("tabs that join a run", () => {
  const opened = (ref: string) => ({
    device_id: "device",
    kind: "browser_tab",
    opaque_ref: ref,
    display_name: "Browser",
    capabilities: ["browser.snapshot"],
    metadata: { app_id: "browser", remote_session: true },
    run_grant: grant,
  });

  it("joins the agent's own tab, which the next call may then use", async () => {
    await start({}, [workspace]);
    await expect(call("browser.snapshot", { scopeId: "agent-scope-2" })).rejects.toThrow(
      "not allowed",
    );
    mocks.execute.mockResolvedValueOnce({ tabs: [opened("agent-scope-2")] });
    await expect(
      call("screen.open", { reason: "to read", url: "https://a.co" }),
    ).resolves.toMatchObject({ status: "open", scopeId: "agent-scope-2", catalog_changed: true });
    expect(lastJob()).toMatchObject({
      operation: "browser.session",
      nodeId: "browser_session_call",
    });
    const entry = await loadRunEntry("run");
    expect(entry?.contexts[entry.contexts.length - 1].metadata).toMatchObject({
      window_label: "main",
      opened_url: "https://a.co",
    });
    mocks.execute.mockResolvedValueOnce({ page: true });
    await expect(call("browser.snapshot", { scopeId: "agent-scope-2" })).resolves.toEqual({
      page: true,
    });
    expect(lastJob().config.runGrant).toEqual(grant);
  });

  it("goes back to a page it already opened", async () => {
    await start({}, [workspace]);
    mocks.execute.mockResolvedValueOnce({ tabs: [opened("agent-scope-2")] });
    await call("screen.open", { reason: "to read", url: "https://a.co" });
    mocks.execute.mockClear();
    await expect(
      call("screen.open", { reason: "to read", url: "https://a.co" }),
    ).resolves.toMatchObject({ scopeId: "agent-scope-2" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("refuses a tab the device opened without a grant", async () => {
    await start({}, [workspace]);
    mocks.execute.mockResolvedValueOnce({
      tabs: [{ ...opened("agent-scope-2"), run_grant: null }],
    });
    const error = await failure(call("screen.open", { reason: "to read", url: "https://a.co" }));
    expect(error.message).toContain("returned an invalid browser session");
  });

  it("joins the tabs a program opened, and hides them from the model", async () => {
    await start({}, [workspace]);
    mocks.execute.mockResolvedValueOnce({ ok: true, opened: [opened("agent-scope-3")] });
    const result = (await call("browser.run", { code: "return 1" })) as Record<string, unknown>;
    expect(result).toEqual({ ok: true, catalog_changed: true });
    const entry = await loadRunEntry("run");
    expect(entry?.contexts.map((item) => item.opaqueRef)).toContain("agent-scope-3");
  });

  it("says when a program's tab could not join", async () => {
    await start({}, [workspace]);
    mocks.execute.mockResolvedValueOnce({
      opened: [{ ...opened("agent-scope-3"), kind: "other" }],
    });
    const result = (await call("browser.run", { code: "return 1" })) as Record<string, unknown>;
    expect(result.tabsNote).toContain("could not join");
  });

  it("closes only its own later tabs", async () => {
    const own = (ref: string) => tab(ref, { remote_session: true });
    await start({}, [workspace, own("agent-scope-1"), own("agent-scope-2")]);
    await expect(call("screen.close", { scopeId: "agent-scope-1" })).rejects.toThrow("first tab");
    await expect(call("screen.close", { scopeId: "agent-scope-9" })).rejects.toThrow("not one of");
    await expect(call("screen.close", { scopeId: "agent-scope-2" })).resolves.toMatchObject({
      status: "closed",
    });
    expect(lastJob().input.closeScope).toBe("agent-scope-2");
    const entry = await loadRunEntry("run");
    expect(entry?.contexts.map((item) => item.opaqueRef)).not.toContain("agent-scope-2");
  });
});
