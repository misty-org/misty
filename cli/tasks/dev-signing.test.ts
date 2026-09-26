import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectDevelopmentIdentity,
  signedDevArguments,
  prepareTauriDevelopment,
} from "./dev-signing.ts";

const development = "A".repeat(40);
const distribution = "B".repeat(40);
const listing = `  1) ${distribution} "Developer ID Application: Example (TEAM)"\n  2) ${development} "Apple Development: Example (TEAM)"\n     2 valid identities found`;

test("dev selects the development certificate, never an ad-hoc identity", () => {
  assert.equal(selectDevelopmentIdentity(listing), development);
  assert.equal(selectDevelopmentIdentity(listing, distribution.toLowerCase()), distribution);
  assert.throws(() => selectDevelopmentIdentity(listing, "-"));
  assert.throws(() => selectDevelopmentIdentity("0 valid identities found"));
});

test("multiple development identities require an explicit selection", () => {
  const multiple = listing + `\n  3) ${"C".repeat(40)} "Apple Development: Another (OTHER)"`;
  assert.throws(() => selectDevelopmentIdentity(multiple));
  assert.equal(
    selectDevelopmentIdentity(multiple, "Apple Development: Example (TEAM)"),
    development,
  );
});

test("signing runs after Cargo builds, retaining config and application arguments", () => {
  const args = signedDevArguments(
    ["dev", "--config", "profile.json", "--", "--app-option"],
    "/Node path/node",
    '/Repo path/"quoted"/runner.ts',
  );
  assert.deepEqual(args.slice(0, 4), ["dev", "--config", "profile.json", "--config"]);
  assert.deepEqual(args.slice(-2), ["--", "--app-option"]);
  const runner = JSON.parse(args[4]).build.runner;
  assert.equal(runner.cmd, "cargo");
  assert.equal(runner.args.length, 4);
  for (const index of [0, 2]) {
    assert.equal(runner.args[index], "--config");
    const array = runner.args[index + 1].split(" = ")[1];
    assert.deepEqual(JSON.parse(array), ["/Node path/node", '/Repo path/"quoted"/runner.ts']);
  }
});

test("release builds, mobile dev, and help do not use development signing", () => {
  for (const args of [["build"], ["ios", "dev"], ["android", "dev"], ["dev", "--help"]]) {
    assert.deepEqual(prepareTauriDevelopment(args), args);
  }
});
