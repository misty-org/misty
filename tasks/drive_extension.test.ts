import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appGroup,
  bundleVersion,
  certificateForHash,
  extensionBundleId,
  extensionTargets,
  teamIdFromSubject,
} from "./drive_extension.ts";

test("dev and release builds keep their Space drives apart", () => {
  assert.equal(extensionBundleId(true), "com.misty.desktop.drive");
  assert.equal(extensionBundleId(false), "com.misty.desktop.drivedev");
  assert.ok(extensionBundleId(false).startsWith("com.misty.desktop."));
  assert.equal(appGroup("ABCDE12345", true), "ABCDE12345.com.misty.desktop");
  assert.equal(appGroup("ABCDE12345", false), "ABCDE12345.com.misty.desktop.dev");
  assert.throws(() => appGroup("not a team", true));
});

test("the extension's version is Misty's, numbers only", () => {
  assert.equal(bundleVersion("0.1.0-beta.1"), "0.1.0");
  assert.equal(bundleVersion("2.10.3"), "2.10.3");
  assert.throws(() => bundleVersion("beta"));
});

test("the Team ID comes from the certificate's organizational unit", () => {
  assert.equal(
    teamIdFromSubject(
      "subject=UID=XYZ987,CN=Apple Development: Example (PERSON1234),OU=ABCDE12345,O=Example,C=US",
    ),
    "ABCDE12345",
  );
  assert.equal(teamIdFromSubject("subject=CN=Apple Development: Example (PERSON1234),O=Example"), undefined);
});

test("a certificate is found by its SHA-1 among the keychain's", () => {
  const first = "1".repeat(40);
  const second = "A".repeat(40);
  const listing = [
    `SHA-256 hash: ${"0".repeat(64)}\nSHA-1 hash: ${first}\n-----BEGIN CERTIFICATE-----\nONE\n-----END CERTIFICATE-----\n`,
    `SHA-256 hash: ${"0".repeat(64)}\nSHA-1 hash: ${second}\n-----BEGIN CERTIFICATE-----\nTWO\n-----END CERTIFICATE-----\n`,
  ].join("");
  assert.equal(
    certificateForHash(listing, second.toLowerCase()),
    "-----BEGIN CERTIFICATE-----\nTWO\n-----END CERTIFICATE-----",
  );
  assert.equal(certificateForHash(listing, "B".repeat(40)), undefined);
});

test("the extension is built for the architectures the app is", () => {
  assert.deepEqual(extensionTargets("aarch64-apple-darwin"), ["aarch64-apple-darwin"]);
  assert.deepEqual(extensionTargets("x86_64-apple-darwin"), ["x86_64-apple-darwin"]);
  assert.deepEqual(extensionTargets("universal-apple-darwin"), ["aarch64-apple-darwin", "x86_64-apple-darwin"]);
  assert.deepEqual(extensionTargets(undefined), ["aarch64-apple-darwin", "x86_64-apple-darwin"]);
});
