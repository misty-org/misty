import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDevelopmentProfile } from "./dev-build.ts";

test("dev profiles keep the shared Cargo configuration", () => {
  const environment: NodeJS.ProcessEnv = { MISTY_PROFILE: "dev1" };
  checkDevelopmentProfile(["dev"], environment);
  assert.deepEqual(environment, { MISTY_PROFILE: "dev1" });
});

test("only dev runs check the profile name", () => {
  for (const args of [["build"], ["dev", "--help"], ["dev", "-h"]]) {
    checkDevelopmentProfile(args, { MISTY_PROFILE: "../dev1" });
  }
  checkDevelopmentProfile(["dev"], {});
  for (const profile of ["", "../dev1", "/dev1", "Dev1", "a".repeat(33)]) {
    assert.throws(() => checkDevelopmentProfile(["dev"], { MISTY_PROFILE: profile }));
  }
});
