import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { programPrelude } from "./prelude";
import { runInSandbox, setSandboxWasm } from "./sandbox";

beforeAll(() =>
  setSandboxWasm(
    createRequire(import.meta.url).resolve("@jitl/quickjs-wasmfile-release-sync/wasm"),
  ),
);

const deadline = () => Date.now() + 10_000;

describe("browser_run sandbox", () => {
  it("runs a program against the page API and returns its value", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const host = async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === "open") return { id: "tab-1", url: String(args.url), title: "Shop" };
      if (name === "act") return { ok: true, url: "https://shop.test/search?q=joggers" };
      if (name === "text")
        return {
          url: "https://shop.test/search",
          title: "Results",
          text: "Jogger A $25\nJogger B $30",
        };
      return null;
    };
    const code = `
      const t = await openTab("https://shop.test");
      await t.type({ role: "searchbox", name: "" }, "joggers", { submit: true });
      const page = await t.text({ maxChars: 500 });
      log("read", page.title);
      return page.text.split("\\n").map((line) => line.split(" $")[0]);`;
    const result = await runInSandbox(programPrelude, code, host, { deadline: deadline() });
    expect(result).toMatchObject({
      ok: true,
      value: ["Jogger A", "Jogger B"],
      logs: ["read Results"],
    });
    expect(calls.map(([name]) => name)).toEqual(["open", "act", "text"]);
    expect(calls[1]![1]).toMatchObject({
      tab: "tab-1",
      action: "type",
      target: { role: "searchbox", name: "" },
      text: "joggers",
      submit: true,
    });
  });

  it("gives the program a host failure as a catchable error with its real reason", async () => {
    const host = async (name: string) => {
      if (name === "act") throw new Error('link "Cocktail Dresses" is covered by img.');
      return { id: "t", url: "", title: "" };
    };
    const caught = await runInSandbox(
      programPrelude,
      `const t = await getTab("t"); try { await t.click("Cocktail Dresses"); } catch (error) { return error.message; }`,
      host,
      { deadline: deadline() },
    );
    expect(caught).toMatchObject({ ok: true, value: 'link "Cocktail Dresses" is covered by img.' });
    const thrown = await runInSandbox(
      programPrelude,
      `const t = await getTab("t"); await t.click("x");`,
      host,
      { deadline: deadline() },
    );
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toMatch(/covered by img/);
  });

  it("works on a tab that was not awaited, and scrolls text into view", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const host = async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === "tab") return { id: "tab-2", url: "https://dfas.test", title: "SBP" };
      if (name === "text") return { url: "https://dfas.test", title: "SBP", text: "DD 2656-7" };
      return { ok: true };
    };
    const code = `const page = await getTab("dfas").text({ maxChars: 100 }); await getTab("dfas").scrollTo("DD 2656-7"); return page.text;`;
    const result = await runInSandbox(programPrelude, code, host, { deadline: deadline() });
    expect(result).toMatchObject({ ok: true, value: "DD 2656-7" });
    expect(calls.find(([name]) => name === "act")![1]).toMatchObject({
      tab: "tab-2",
      action: "scroll",
      text: "DD 2656-7",
    });
  });

  it("names a tab method that does not exist, and maps Playwright names onto real ones", async () => {
    const calls: string[] = [];
    const host = async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "tab") return { id: "t", url: "https://cars.test", title: "Cars" };
      if (name === "text") return { url: "https://cars.test", title: "Cars", text: "RAV4" };
      return { ok: true, args };
    };
    const missing = await runInSandbox(programPrelude, `const t = await getTab("cars"); await t.evaluate("1");`, host, { deadline: deadline() });
    expect(missing).toMatchObject({ ok: false });
    expect(JSON.stringify(missing)).toMatch(/tab\.evaluate\(\) does not exist\. A tab has: read, text/);
    const unawaited = await runInSandbox(programPrelude, `await getTab("cars").clickOn("Search");`, host, { deadline: deadline() });
    expect(JSON.stringify(unawaited)).toMatch(/tab\.clickOn\(\) does not exist/);
    const mapped = await runInSandbox(
      programPrelude,
      `const t = await getTab("cars"); await t.waitForLoadState(); await t.navigate("https://cars.test/used"); log(JSON.stringify(t)); return (await t.innerText()).text;`,
      host,
      { deadline: deadline() },
    );
    expect(mapped).toMatchObject({ ok: true, value: "RAV4" });
    expect(calls).toContain("goto");
  });

  it("lets a program name its own variables tabs and tab", async () => {
    const host = async (name: string) =>
      name === "tabs" ? [{ id: "a", url: "https://a.test", title: "A" }] : null;
    const result = await runInSandbox(
      programPrelude,
      `const tabs = await listTabs(); const tab = tabs[0]; return tab.url;`,
      host,
      { deadline: deadline() },
    );
    expect(result).toMatchObject({ ok: true, value: "https://a.test" });
  });

  it("takes find options as an object and waits on a RegExp by reading the page", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const host = async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === "tab") return { id: "t", url: "", title: "" };
      if (name === "text") return { url: "", title: "", text: "Season 2, Episode 1" };
      return [];
    };
    const result = await runInSandbox(
      programPrelude,
      `const t = await getTab("t"); await t.find({ words: "Season 2" }); return t.waitFor({ text: /season \\d/i });`,
      host,
      { deadline: deadline() },
    );
    expect(result).toMatchObject({ ok: true, value: { met: true } });
    expect(calls.find(([name]) => name === "find")![1]).toMatchObject({ query: "Season 2" });
  });

  it("has no network, app or host globals, and stops a program that spins", async () => {
    const host = async () => null;
    const globals = await runInSandbox(
      programPrelude,
      `return [typeof fetch, typeof XMLHttpRequest, typeof window, typeof process, typeof require];`,
      host,
      { deadline: deadline() },
    );
    expect(globals).toMatchObject({
      ok: true,
      value: ["undefined", "undefined", "undefined", "undefined", "undefined"],
    });
    const spinning = await runInSandbox(programPrelude, `while (true) {}`, host, {
      deadline: Date.now() + 300,
    });
    expect(spinning.ok).toBe(false);
  });
});
