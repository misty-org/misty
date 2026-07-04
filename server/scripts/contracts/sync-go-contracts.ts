import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { mistyInboxCapabilities, mistySocialCapabilities, mistyTaskCapabilities, MistyBrowserInteractionSchema } from "@misty/contracts";

// Reserve Misty-owned semantic definitions before any downloaded provider can
// claim them. This is the same SDK data, not a second handwritten tool catalog.
const capabilityTarget = new URL("../../internal/capabilities/builtins.json", import.meta.url);
const capabilityExpected = JSON.stringify([...mistyInboxCapabilities, ...mistySocialCapabilities, ...mistyTaskCapabilities], null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (await readFile(capabilityTarget, "utf8") !== capabilityExpected) throw new Error("Go capability contracts differ from the packaged SDK snapshot");
} else await writeFile(capabilityTarget, capabilityExpected);

// The runtime driver uses the SDK interaction vocabulary, not a parallel schema.
const browserTarget = new URL("../../internal/capabilities/browser-interaction.json", import.meta.url);
const browserExpected = JSON.stringify(z.toJSONSchema(MistyBrowserInteractionSchema), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (await readFile(browserTarget, "utf8") !== browserExpected) throw new Error("Browser interaction schema differs from the SDK snapshot");
} else await writeFile(browserTarget, browserExpected);

