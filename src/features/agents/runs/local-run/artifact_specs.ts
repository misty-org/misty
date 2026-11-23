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
