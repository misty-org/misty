import assert from "node:assert/strict";
import test from "node:test";

import { demoRoutes, normalizeAPIBase, parseCLI, validateManifest } from "./demo-harness-core.mjs";

test("normalizes API base URLs exactly once", () => {
  assert.equal(normalizeAPIBase("https://demo.misty.test/"), "https://demo.misty.test/api");
  assert.equal(normalizeAPIBase("https://demo.misty.test/api"), "https://demo.misty.test/api");
  assert.throws(() => normalizeAPIBase("demo.misty.test"), /http/);
});

test("parses supported commands and target", () => {
  assert.deepEqual(parseCLI(["node", "script", "seed", "--target", "staging"]), { command: "seed", target: "staging" });
  assert.deepEqual(parseCLI(["node", "script", "verify", "--target=local"]), { command: "verify", target: "local" });
  assert.throws(() => parseCLI(["node", "script", "clean", "--target=staging"]), /only supports/);
});

test("manifest safety validation reserves demo identities and six fixtures", () => {
  const valid = {
    id: "product-research-hub", version: 2, scenarioVersion: "product-research-hub@2",
    space: { name: "Product Research Hub" },
    users: { owner: { email: "maya@demo.misty.local" }, collaborator: { email: "jordan@demo.misty.local" } },
    assets: Array.from({ length: 6 }, (_, index) => ({ key: `asset-${index}`, file: `${index}.png`, mimeType: "image/png", contributor: index % 2 ? "owner" : "collaborator" })),
    album: { name: "Core Evidence" }, agent: { name: "Summarizer" },
    workflow: { name: "Digest", definition: { nodes: [{ kind: "manual_trigger" }, { kind: "notify" }] } },
    agentMessage: "Grounded response",
  };
  assert.equal(validateManifest(valid), valid);
  assert.throws(() => validateManifest({ ...valid, assets: valid.assets.slice(0, 5) }), /six fixtures/);
  assert.throws(() => validateManifest({ ...valid, users: { ...valid.users, owner: { email: "maya@example.com" } } }), /reserved suffix/);
});

test("golden-path routes include all six desktop destinations", () => {
  const routes = demoRoutes("space_123");
  assert.deepEqual(Object.keys(routes), ["library", "chat", "agent", "workflow", "members", "settings"]);
  assert.equal(routes.library.deep_link, "misty://open/spaces/space_123/library");
});
