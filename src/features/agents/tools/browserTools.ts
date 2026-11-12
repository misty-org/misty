import { localAttachmentFile } from "../conversations/composer/localAttachments";
import { invoke } from "@/native/invoke";
import {
  argumentsInvalid,
  browserToolFailure,
  deviceFailureMessage,
  invalidRequest,
  notAllowed,
  observationFailed,
} from "./deviceFailures";
import { browserToolConfig, buildDeviceJob, settleDeviceJob } from "./deviceJob";
import { extractionReply } from "./extractLinks";
import { LocalToolRejected, type LocalToolRequest } from "./host";
import {
  adoptChatTab,
  browserScopeAllowed,
  browserToolSurface,
  contextFor,
  scopeTaskId,
  type RunEntry,
} from "./runContexts";

/**
 * The tools that work one attached screen (`executeBrowserAgentToolInvocation`): the exact target is
 * rechecked, the input is checked before anything acts, and the job runs here under the grant this
 * computer signed. Whether the person is asked was settled natively before this call got here.
 */

const screenAct = "browser.act";
const schemaLimit = 16 << 10;

const localSuffixes = [
  ".local",
  ".lan",
  ".home",
  ".internal",
  ".intranet",
  ".corp",
  ".home.arpa",
  ".localhost",
  ".test",
];

/** A name to look up: not an address, and not one that only a local network knows. */
export function hostToCheck(raw: string): string | null {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  const address = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  if (!host || address || !host.includes(".")) return null;
  return localSuffixes.some((suffix) => host.endsWith(suffix)) ? null : host;
}

/**
 * An address whose host has no DNS record at all becomes a correction the agent can act on, before
 * any tab opens. An agent that guessed jjs-house.com for jjshouse.com opened it twice, got pages that
 * never loaded and called the site a blocker. Only a definite "no such host" counts: a slow or
 * failing lookup leaves the page to load.
 */
export async function addressWithoutHost(raw: string) {
  const host = hostToCheck(raw);
  if (!host) return;
  const missing = await invoke<boolean>("agent_host_missing", { host }).catch(() => false);
  if (missing) {
    throw invalidRequest(
      `${host} does not exist, so the address is wrong and nothing was opened. Find the site's ` +
        `real address by searching for its name, then open that. If the site itself is gone (renamed, ` +
        `merged into another, shut down), do not retry other spellings of the same address: search ` +
        `for where its coverage lives now, open that, and say so in your answer.`,
    );
  }
}

function checkExtractRequest(input: Record<string, unknown>) {
  const instruction = input.instruction;
  if (typeof instruction !== "string" || !instruction.trim() || instruction.length > 4000) {
    throw invalidRequest("browser_extract needs an instruction");
  }
  const schema = input.schema as { type?: unknown } | undefined;
  if (!schema || JSON.stringify(schema).length > schemaLimit || schema.type !== "object") {
    throw invalidRequest("browser_extract needs a JSON Schema whose top level has type object");
  }
}

async function attachmentDetails(file: { id: string; name: string }) {
  try {
    const blob = await localAttachmentFile(file.id);
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return { ...file, mimeType: blob.type, byteSize: blob.size, sha256 };
  } catch {
    throw new LocalToolRejected(
      "invalid_task_file",
      deviceFailureMessage("device_execution_failed"),
    );
  }
}

/** Checks an upload's source and names it in the job (`applyBrowserUploadConfig`). */
async function uploadConfig(entry: RunEntry, input: Record<string, unknown>) {
  const target = [input.elementRef, input.ref].filter(Boolean);
  if (target.length !== 1) throw argumentsInvalid();
  const { attachmentId, downloadId, sourceScopeId } = input as Record<string, string | undefined>;
  if (downloadId && sourceScopeId && !attachmentId) {
    // Download reuse is for a live personal-agent task. Native code also checks the task owns it.
    if (!entry.agentId || !entry.taskId || !browserScopeAllowed(entry, sourceScopeId)) {
      throw notAllowed();
    }
    return { downloadUpload: { downloadId, sourceScopeId } };
  }
  if (!attachmentId || downloadId || sourceScopeId) throw argumentsInvalid();
  const file = entry.attachments.find((item) => item.id === attachmentId);
  if (!file) throw notAllowed();
  return { upload: await attachmentDetails(file) };
}

export async function runBrowserTool(request: LocalToolRequest, started: RunEntry) {
  const name = request.name;
  const scopeId = typeof request.input.scopeId === "string" ? request.input.scopeId : "";
  if (scopeId.length < 8) throw argumentsInvalid();
  let entry = started;
  if (!browserScopeAllowed(entry, scopeId)) {
    // A tab this chat's agent opened in an earlier turn is still its own.
    const adopted = await adoptChatTab(entry, scopeId);
    if (!adopted || !browserScopeAllowed(adopted, scopeId)) throw notAllowed();
    entry = adopted;
  }
  const context = contextFor(entry, scopeId, name);
  if (!context) throw new LocalToolRejected("invalid_scope", deviceFailureMessage("invalid_scope"));
  const surface = browserToolSurface(entry, scopeId);
  // Acting on the Misty window or the desktop needs the foreground task in the main window.
  if (name.startsWith("browser.workspace.") || (name === screenAct && surface !== "browser")) {
    if (
      entry.executionMode !== "agent" ||
      entry.windowLabel !== "main" ||
      !entry.taskId ||
      surface === "browser"
    ) {
      throw notAllowed();
    }
  }
  const config: Record<string, unknown> = {
    ...browserToolConfig(entry, request.policyCall),
    taskId: scopeTaskId(entry, scopeId),
    ...(name === screenAct ? { surface } : {}),
    ...(name === "browser.upload" ? await uploadConfig(entry, request.input) : {}),
  };
  if (name === "browser.extract") checkExtractRequest(request.input);
  if (name === "browser.navigate") await addressWithoutHost(String(request.input.url ?? ""));
  const input = request.input;
  const outcome = await settleDeviceJob(
    buildDeviceJob({
      entry,
      context,
      callId: request.callId,
      node: "browser_tool",
      operation: name,
      input,
      config,
    }),
    request.signal,
  );
  if (!outcome.ok) throw browserToolFailure(name, outcome.error, outcome.stopped);
  if (name !== "browser.extract") return outcome.output;
  const reply = extractionReply(outcome.output);
  if (!reply) throw observationFailed();
  return reply;
}
