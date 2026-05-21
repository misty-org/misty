#!/usr/bin/env node
//
// Claude Code SDK Bridge
// Long-running process: reads JSON commands from stdin, calls the SDK, writes
// structured JSON events to stdout.  The C++ host spawns this once and keeps
// it alive for the lifetime of the panel.
//

const readline = require("readline");

let sdk = null;
let currentAbort = null;
let sessionId = undefined;

// ── helpers ────────────────────────────────────────────────────────────────

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function loadSDK() {
  // 1. Try normal import (works when package is local or NODE_PATH is set)
  try {
    return await import("@anthropic-ai/claude-code");
  } catch (_) {
    /* fall through */
  }

  // 2. Resolve from the global npm prefix
  try {
    const { execSync } = require("child_process");
    const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const { createRequire } = require("module");
    return createRequire(globalRoot + "/")("@anthropic-ai/claude-code");
  } catch (_) {
    /* fall through */
  }

  throw new Error(
    "Cannot load @anthropic-ai/claude-code.  " +
      "Install it with:  npm install -g @anthropic-ai/claude-code"
  );
}

// ── turn handler ───────────────────────────────────────────────────────────

async function handlePrompt(cmd) {
  currentAbort = new AbortController();

  try {
    const options = {};
    if (cmd.cwd) options.cwd = cmd.cwd;
    if (sessionId) {
      options.continue = true;
      options.sessionId = sessionId;
    }
    if (cmd.maxTurns) options.maxTurns = cmd.maxTurns;

    const messages = await sdk.query({
      prompt: cmd.prompt,
      abortController: currentAbort,
      options,
    });

    // Walk the message array and emit structured events for the C++ host.
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : [{ type: "text", text: String(msg.content) }];

        for (const block of blocks) {
          if (block.type === "text") {
            emit({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            emit({
              type: "tool_use",
              name: block.name,
              id: block.id,
              input: block.input,
            });
          }
        }
      } else if (msg.role === "user") {
        // Tool results arrive as user messages in the Anthropic format.
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        for (const block of blocks) {
          if (block.type === "tool_result") {
            let text = "";
            if (typeof block.content === "string") {
              text = block.content;
            } else if (Array.isArray(block.content)) {
              text = block.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n");
            }
            emit({ type: "tool_result", tool_use_id: block.tool_use_id, content: text });
          }
        }
      }
    }

    // Try to capture the session ID from the last assistant message or SDK
    // internals so subsequent turns can --continue.
    if (messages._meta && messages._meta.sessionId) {
      sessionId = messages._meta.sessionId;
    }

    emit({ type: "result", status: "success", message_count: messages.length });
  } catch (err) {
    if (err.name === "AbortError") {
      emit({ type: "result", status: "aborted" });
    } else {
      emit({ type: "error", text: err.message });
    }
  } finally {
    currentAbort = null;
  }
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    sdk = await loadSDK();
    emit({ type: "system", status: "ready" });
  } catch (err) {
    emit({ type: "error", text: err.message });
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on("line", async (line) => {
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch (err) {
      emit({ type: "error", text: "Invalid JSON: " + err.message });
      return;
    }

    switch (cmd.type) {
      case "prompt":
        await handlePrompt(cmd);
        break;
      case "abort":
        if (currentAbort) currentAbort.abort();
        break;
      case "exit":
        process.exit(0);
        break;
      default:
        emit({ type: "error", text: "Unknown command: " + cmd.type });
    }
  });

  rl.on("close", () => process.exit(0));
}

main();
