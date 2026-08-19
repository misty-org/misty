import { describe, expect, it } from "vitest";
import { languageFor } from "./useLsp";

describe("useLsp languageFor", () => {
  it("maps web languages", () => {
    expect(languageFor("app.ts")).toBe("typescript");
    expect(languageFor("Component.tsx")).toBe("typescript");
    expect(languageFor("index.js")).toBe("javascript");
    expect(languageFor("module.mjs")).toBe("javascript");
    expect(languageFor("data.json")).toBe("json");
    expect(languageFor("index.html")).toBe("html");
    expect(languageFor("styles.css")).toBe("css");
    expect(languageFor("theme.scss")).toBe("css");
  });

  it("maps systems and backend languages", () => {
    expect(languageFor("main.rs")).toBe("rust");
    expect(languageFor("server.go")).toBe("go");
    expect(languageFor("main.cpp")).toBe("cpp");
    expect(languageFor("header.hpp")).toBe("cpp");
    expect(languageFor("core.c")).toBe("cpp");
    expect(languageFor("script.py")).toBe("python");
    expect(languageFor("deploy.sh")).toBe("bash");
    expect(languageFor("init.lua")).toBe("lua");
    expect(languageFor("app.zig")).toBe("zig");
  });

  it("maps config formats", () => {
    expect(languageFor("docker-compose.yml")).toBe("yaml");
    expect(languageFor("config.yaml")).toBe("yaml");
  });

  it("returns null for unsupported languages", () => {
    expect(languageFor("unknown.xyz")).toBeNull();
    expect(languageFor("image.png")).toBeNull();
  });
});
