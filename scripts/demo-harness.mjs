#!/usr/bin/env node
import {
  APIClient, Report, credentialsPath, loadCredentials, loadManifest, parseCLI, readJSON, writePrivateJSON,
} from "./demo-harness-core.mjs";
import { cleanLocal, ensureLocalStack, launchDesktop, targetAPIBase } from "./demo-harness-local.mjs";
import { liveAgentCheck, seedScenario, verifyScenario } from "./demo-harness-scenario.mjs";

let report;

function classifyFailure(error) {
  const text = String(error?.message || error).toLowerCase();
  if (/login|register|session|authenticated/.test(text)) return "auth";
  if (/library\/uploads|upload|download/.test(text)) return "uploads";
  if (/preview/.test(text)) return "previews";
  if (/invitation|members|spaces\//.test(text)) return "space-switching";
  if (/conversation|messages|library_item_ids|reference/.test(text)) return "references";
  if (/agent|\/ai\//.test(text)) return "agent-invocation";
  if (/workflow|runs/.test(text)) return "workflow-history";
  return "harness";
}

function printRoutes(state) {
  console.log("\nDemo routes");
  for (const [name, route] of Object.entries(state.routes)) {
    console.log(`  ${name.padEnd(9)} ${route.deep_link}`);
  }
}

async function main() {
  const { command, target } = parseCLI(process.argv);
  const manifest = await loadManifest();
  report = new Report(command, target, manifest.scenarioVersion);
  const hadLocalCredentials = target === "local" && Boolean(await readJSON(credentialsPath, true));
  const credentials = await loadCredentials(target, manifest);
  let baseURL = targetAPIBase(target);

  if (command === "clean") {
    await cleanLocal(report);
    const path = await report.save("passed");
    console.log(`Removed the isolated local demo server state and Docker volumes. This cleanup is not recoverable.\nReport: ${path}`);
    return;
  }

  if (target === "local") {
    const local = await ensureLocalStack(credentials, report);
    baseURL = local.baseURL;
  } else {
    const admin = new APIClient(baseURL, credentials.adminToken, report);
    const status = await admin.request("GET", "/internal/demo/status");
    if (status.data.mode !== "staging" || !status.data.ready) throw new Error("The staging URL is not a ready, dedicated staging demo server");
  }

  let state;
  if (command === "seed" || command === "run") {
    const seeded = await seedScenario(baseURL, credentials, manifest, report);
    state = seeded.state;
    if (target === "local") {
      credentials.ownerToken = seeded.ownerSession.token;
      credentials.collaboratorToken = seeded.collaboratorSession.token;
      await writePrivateJSON(credentialsPath, credentials);
    }
  } else {
    state = await readJSON((await import("./demo-harness-core.mjs")).statePath);
  }

  if (command === "verify" || command === "run") {
    state = await verifyScenario(baseURL, credentials, manifest, report, state);
  }
  if (command === "live-check") {
    const result = await liveAgentCheck(baseURL, credentials, manifest, report);
    if (!result.ok) console.warn(`Live Agent warning: ${result.warning}`);
  }

  if (state?.routes) printRoutes(state);
  const reportPath = await report.save("passed");
  console.log(`\nDemo ${command} completed.\nReport: ${reportPath}`);

  if (command === "run") {
    if (!hadLocalCredentials && target === "local") console.log("This is the first bootstrap. The demo owner session will be activated automatically.");
    await launchDesktop(baseURL, state.routes, {
      ownerId: state.accounts.owner.id,
      ownerName: manifest.users.owner.name,
      ownerUsername: manifest.users.owner.username,
      ownerEmail: manifest.users.owner.email,
      ownerPassword: credentials.ownerPassword,
      ownerToken: credentials.ownerToken,
    });
  }
}

main().catch(async (error) => {
  console.error(`\nDemo harness failed: ${error.stack || error}`);
  if (report) {
    report.data.bugs.push({ classification: classifyFailure(error), phase: "fatal", error: error.message });
    try {
      const path = await report.save("failed");
      console.error(`Partial state was preserved for inspection.\nReport: ${path}`);
    } catch (reportError) {
      console.error(`Could not save the failure report: ${reportError.message}`);
    }
  }
  process.exitCode = 1;
});
