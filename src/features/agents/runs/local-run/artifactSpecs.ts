/**
 * What each proposal kind is and how risky (`ai_artifact_specs.go`, `inferredAIArtifactKind`). The
 * shapes and prompts the model reads are in the crate's `local_prompt/artifact_specs.rs`.
 */

interface ArtifactSpec {
  title: string;
  risk: string;
  approvalPolicy: string;
}

export const artifactSpecs: Record<string, ArtifactSpec> = {
  message_draft: { title: "Review message draft", risk: "draft", approvalPolicy: "visible_apply" },
  terminal_command: {
    title: "Review terminal command",
    risk: "dangerous",
    approvalPolicy: "always_confirm",
  },
  browser_action: {
    title: "Review browser action",
    risk: "dangerous",
    approvalPolicy: "always_confirm",
  },
  transfer_plan: {
    title: "Review transfer recovery",
    risk: "consequential",
    approvalPolicy: "confirm",
  },
  extension_action: {
    title: "Review extension action",
    risk: "dangerous",
    approvalPolicy: "always_confirm",
  },
};

const words: Record<string, { kind: string; needsSelection?: boolean; any: string[] }> = {
  "space.chat": { kind: "message_draft", any: ["draft", "reply", "write message"] },
  terminal: { kind: "terminal_command", any: ["run", "execute", "command", "install"] },
  browser: {
    kind: "browser_action",
    any: ["click", "navigate", "fill", "submit", "upload", "open page"],
  },
  transfers: { kind: "transfer_plan", any: ["retry", "resume", "cancel", "recover"] },
  extensions: { kind: "extension_action", any: ["install", "configure", "run", "enable"] },
};

/** A surface's own words ask for a reviewable change rather than an answer. */
export function inferredArtifactKind(
  surfaceId: string,
  prompt: string,
  hasSelection: boolean,
): string {
  const rule = words[surfaceId];
  const text = prompt.trim().toLowerCase();
  if (!rule || !text || (rule.needsSelection && !hasSelection)) return "";
  return rule.any.some((word) => text.includes(word)) ? rule.kind : "";
}
