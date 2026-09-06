import { expect, it } from "vitest";
import type { OfficialApp } from "@/api/apps";
import { assertAppCompatible } from "./appCompatibility";
it("checks host semver separately from component protocol", () => {
  const app = {name:"Code", minimum_host_protocol:2, minimum_host_version:"0.1.0-beta.1"} as OfficialApp;
  expect(() => assertAppCompatible(app)).not.toThrow();
  expect(() => assertAppCompatible({...app,minimum_host_version:"0.1.0-beta.2"})).toThrow(/Update Misty/);
  expect(() => assertAppCompatible({...app,minimum_host_protocol:3})).toThrow();
  expect(() => assertAppCompatible({...app,minimum_host_version:"invalid"})).toThrow();
});
