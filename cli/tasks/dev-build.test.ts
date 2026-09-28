import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { developmentBuildEnvironment } from "./dev-build.ts";

const execute = promisify(execFile);

test("profile builds isolate artifacts and intermediates with stable paths", () => {
  const root = resolve("fixture repository");
  const first = developmentBuildEnvironment(["dev"], { MISTY_DESKTOP_PROFILE: "dev1" }, root);
  const second = developmentBuildEnvironment(["dev"], { MISTY_DESKTOP_PROFILE: "dev2" }, root);
  assert.equal(first.CARGO_TARGET_DIR, join(root, "src-tauri/target/dev-profiles/dev1"));
  assert.equal(first.CARGO_BUILD_BUILD_DIR, first.CARGO_TARGET_DIR);
  assert.notEqual(first.CARGO_TARGET_DIR, second.CARGO_TARGET_DIR);
  assert.notEqual(first.CARGO_BUILD_BUILD_DIR, second.CARGO_BUILD_BUILD_DIR);
  assert.deepEqual(first, developmentBuildEnvironment(["dev"], { MISTY_PROFILE: "dev1" }, root));
});

test("custom Cargo roots are still partitioned by profile", () => {
  const root = resolve("fixture repository");
  const environment = {
    MISTY_DESKTOP_PROFILE: "dev2",
    CARGO_TARGET_DIR: resolve("artifact cache"),
    CARGO_BUILD_TARGET_DIR: "unused",
    CARGO_BUILD_BUILD_DIR: "intermediates",
  };
  assert.deepEqual(developmentBuildEnvironment(["dev"], environment, root), {
    CARGO_TARGET_DIR: resolve("artifact cache/dev-profiles/dev2"),
    CARGO_BUILD_BUILD_DIR: join(root, "src-tauri/intermediates/dev-profiles/dev2"),
  });
  assert.equal(
    developmentBuildEnvironment(
      ["dev"],
      {
        MISTY_PROFILE: "dev1",
        CARGO_BUILD_TARGET_DIR: "fallback",
      },
      root,
    ).CARGO_TARGET_DIR,
    join(root, "src-tauri/fallback/dev-profiles/dev1"),
  );
});

test("ordinary builds, help and unprofiled dev keep their existing Cargo configuration", () => {
  for (const args of [["build"], ["dev", "--help"], ["dev", "-h"]]) {
    assert.deepEqual(developmentBuildEnvironment(args, { MISTY_PROFILE: "dev1" }), {});
  }
  assert.deepEqual(developmentBuildEnvironment(["dev"], {}), {});
  for (const profile of ["", "../dev1", "/dev1", "Dev1", "a".repeat(33)]) {
    assert.throws(() => developmentBuildEnvironment(["dev"], { MISTY_PROFILE: profile }));
  }
});

test(
  "dev1 and dev2 can hold build locks simultaneously and retain their compiled identity",
  {
    timeout: 60000,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "misty parallel cargo "));
    try {
      const native = join(root, "src-tauri");
      await mkdir(join(native, "src"), { recursive: true });
      await writeFile(
        join(native, "Cargo.toml"),
        '[package]\nname = "profile-lock-fixture"\nversion = "0.1.0"\nedition = "2021"\n',
      );
      await writeFile(
        join(native, "src/main.rs"),
        'fn main() { println!("{}", env!("COMPILED_PROFILE")); }',
      );
      // A build script runs while Cargo holds the build-directory lock. Neither
      // can finish until both enter it; sharing either build directory fails.
      await writeFile(
        join(native, "build.rs"),
        `
use std::{env, fs, path::PathBuf, thread, time::{Duration, Instant}};
fn main() {
    let profile = env::var("MISTY_DESKTOP_PROFILE").unwrap();
    let barrier = PathBuf::from(env::var_os("MISTY_TEST_BARRIER").unwrap());
    fs::write(barrier.join(&profile), "ready").unwrap();
    let other = if profile == "dev1" { "dev2" } else { "dev1" };
    let start = Instant::now();
    while !barrier.join(other).exists() {
        assert!(start.elapsed() < Duration::from_secs(20), "profiles share a Cargo build lock");
        thread::sleep(Duration::from_millis(20));
    }
    println!("cargo:rustc-env=COMPILED_PROFILE={profile}");
}
`,
      );
      // Generate the dependency-free lockfile before launching both builds.
      await execute("cargo", ["generate-lockfile", "--offline"], { cwd: native, timeout: 10000 });
      const results = await Promise.allSettled(
        ["dev1", "dev2"].map(async (profile) => {
          const environment: NodeJS.ProcessEnv = { ...process.env, MISTY_DESKTOP_PROFILE: profile };
          // Use private roots even if the developer has a global Cargo override.
          environment.CARGO_TARGET_DIR = join(root, "artifacts");
          environment.CARGO_BUILD_BUILD_DIR = join(root, "intermediates");
          const result = await execute("cargo", ["run", "--offline", "--locked", "--quiet"], {
            cwd: native,
            env: {
              ...environment,
              ...developmentBuildEnvironment(["dev"], environment, root),
              MISTY_TEST_BARRIER: root,
            },
            timeout: 45000,
          });
          assert.equal(result.stdout.trim(), profile);
        }),
      );
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
