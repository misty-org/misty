import { defineMistyCapability, defineMistyCapabilityManifest } from "@misty/sdk";

export const appID = "example.habits";
export const connectionID = "10000000-0000-4000-8000-000000000001";
const entry = {
  type: "object", additionalProperties: false,
  required: ["id", "name", "day", "note", "revision"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    day: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
    note: { type: "string", maxLength: 2000 },
    revision: { type: "integer", minimum: 1 },
  },
};
export const manifest = defineMistyCapabilityManifest({
  protocol: 1,
  providers: [{
    id: `${appID}/backend`, version: 1, label: "Independent habit tracker",
    route: { kind: "backend", connectionId: connectionID },
    capabilities: [
      defineMistyCapability({
        name: "habits.list", version: 1, description: "List recorded habits with explicit pagination.",
        requiredScopes: ["habits.list"],
        effects: { kind: "read", incidental: [], approval: "none", retry: "read_only" },
        inputSchema: { type: "object", additionalProperties: false, properties: {
          cursor: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 100 },
        } },
        outputSchema: { type: "object", additionalProperties: false, required: ["entries", "nextCursor"], properties: {
          entries: { type: "array", maxItems: 100, items: entry },
          nextCursor: { type: ["integer", "null"], minimum: 0 },
        } },
      }),
      defineMistyCapability({
        name: "habits.record", version: 1, description: "Record one habit and an optional note for a calendar day.",
        requiredScopes: ["habits.record"],
        effects: { kind: "write", incidental: [], approval: "interactive", retry: "idempotent" },
        inputSchema: { type: "object", additionalProperties: false, required: ["name", "day"], properties: {
          name: entry.properties.name, day: entry.properties.day, note: entry.properties.note,
        } },
        outputSchema: entry,
      }),
    ],
  }],
});
export const installDocument = {
  appId: appID, version: "1.0.0", permissionVersion: 1,
  scopes: ["capabilities.providers.write", "capabilities.read", "capabilities.invoke", "habits.list", "habits.record"],
  capabilities: manifest,
};
