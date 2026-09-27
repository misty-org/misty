import assert from "node:assert/strict";
import test from "node:test";
import { cargoRev, snapshot, vendorDirs, vendoredRev } from "./audeeo-core.ts";

test("both vendored @audeeo/core copies match the crate's pinned commit", () => {
  const [desktop, runtime] = vendorDirs;
  assert.match(cargoRev(), /^[0-9a-f]{40}$/);
  assert.equal(vendoredRev(desktop!), cargoRev());
  assert.equal(vendoredRev(runtime!), cargoRev());
  assert.deepEqual(snapshot(runtime!), snapshot(desktop!));
});
