import { describe, expect, it } from "vitest";
import { loadCodeMirrorLanguage } from "./codeMirrorLanguages";

describe("codeMirrorLanguages", () => {
  it("loads direct languages correctly", async () => {
    const tsSupport = await loadCodeMirrorLanguage("test.ts");
    expect(tsSupport).not.toBeNull();

    const rsSupport = await loadCodeMirrorLanguage("main.rs");
    expect(rsSupport).not.toBeNull();

    const pySupport = await loadCodeMirrorLanguage("script.py");
    expect(pySupport).not.toBeNull();

    const goSupport = await loadCodeMirrorLanguage("server.go");
    expect(goSupport).not.toBeNull();

    const cppSupport = await loadCodeMirrorLanguage("main.cpp");
    expect(cppSupport).not.toBeNull();

    const yamlSupport = await loadCodeMirrorLanguage("config.yaml");
    expect(yamlSupport).not.toBeNull();
  });

  it("loads fallback languages from language-data", async () => {
    const shellSupport = await loadCodeMirrorLanguage("build.sh");
    expect(shellSupport).not.toBeNull();

    const tomlSupport = await loadCodeMirrorLanguage("Cargo.toml");
    expect(tomlSupport).not.toBeNull();

    const luaSupport = await loadCodeMirrorLanguage("init.lua");
    expect(luaSupport).not.toBeNull();
  });

  it("caches loaded languages", async () => {
    const first = await loadCodeMirrorLanguage("index.js");
    const second = await loadCodeMirrorLanguage("other.js");
    expect(first).toBe(second);
  });
});
