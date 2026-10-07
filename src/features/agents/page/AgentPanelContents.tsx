import { Link } from "react-router-dom";
import { FilePen, FileText, Globe, Image } from "lucide-react";
import type { AiArtifactKind } from "@/features/ai-surface/types";
import type { GlobalAiConversation } from "@/features/global-search/types";

const humanize = (value: string) => {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "";
};

/** What the agent made, in the person's words rather than the artifact schema's. */
const madeLabels: Record<AiArtifactKind, string> = {
  text_patch: "Edit",
  task_set: "Tasks",
  calendar_event: "Event",
  roadmap_patch: "Roadmap",
  drawing_patch: "Drawing",
  file_plan: "Files",
  message_draft: "Draft",
  code_patch: "Code",
  terminal_command: "Command",
  browser_action: "Browser",
  transfer_plan: "Transfer",
  extension_action: "Extension",
  image_edit: "Image",
};

/**
 * What the agent read or cited in this conversation: the citations on its answers and
 * the sources behind anything it made, newest first, each once.
 */
export function conversationSources(conversation?: GlobalAiConversation) {
  const seen = new Set<string>();
  return (conversation?.messages ?? [])
    .flatMap((message) => [...(message.citations ?? []), ...(message.artifact?.sources ?? [])])
    .reverse()
    .filter((source) => {
      const key = source.href || source.id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Files in this conversation: what the person attached and what the agent made. */
export function conversationFiles(conversation?: GlobalAiConversation) {
  const messages = conversation?.messages ?? [];
  const attachments = messages.flatMap((message) => message.attachments ?? []);
  return {
    attached: attachments.filter((file) => file.state === "ready").reverse(),
    failed: attachments.filter((file) => file.state === "failed"),
    made: messages.flatMap((message) => (message.artifact ? [message.artifact] : [])).reverse(),
  };
}

/** The Sources section: each source opens where it lives. */
export function AgentSourcesPanel({ conversation }: { conversation?: GlobalAiConversation }) {
  const sources = conversationSources(conversation);
  if (!sources.length)
    return (
      <div className="agent-task-panel">
        <p className="agent-task-panel-note">
          Pages, notes and files the agent reads or cites here are listed so you can check them.
        </p>
      </div>
    );
  return (
    <div className="agent-task-panel">
      <ul>
        {sources.map((source) => {
          const Icon = /^https?:/i.test(source.href) ? Globe : FileText;
          return (
            <li key={source.href || source.id} title={source.href}>
              <Icon size={14} aria-hidden="true" />
              <Link to={source.href} className="agent-task-panel-link">
                {source.title || source.href}
              </Link>
              {source.kind && <small>{humanize(source.kind)}</small>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The Files section: attachments going in, and what the agent made coming out. */
export function AgentFilesPanel({ conversation }: { conversation?: GlobalAiConversation }) {
  const { attached, failed, made } = conversationFiles(conversation);
  if (!attached.length && !failed.length && !made.length)
    return (
      <div className="agent-task-panel">
        <p className="agent-task-panel-note">
          Files you attach and anything the agent makes in this conversation appear here.
        </p>
      </div>
    );
  return (
    <div className="agent-task-panel">
      {(attached.length > 0 || failed.length > 0) && (
        <section>
          <h3>Attached</h3>
          <ul>
            {[...attached, ...failed].map((file) => {
              const Icon = file.mimeType.startsWith("image/") ? Image : FileText;
              return (
                <li key={file.id} title={file.name}>
                  <Icon size={14} aria-hidden="true" />
                  <span>{file.name}</span>
                  <small>
                    {file.state === "failed" ? "! Didn't upload" : formatSize(file.byteSize)}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {made.length > 0 && (
        <section>
          <h3>Made by the agent</h3>
          <ul>
            {made.map((artifact) => (
              <li key={artifact.id} title={artifact.summary || artifact.title}>
                <FilePen size={14} aria-hidden="true" />
                <span>{artifact.title}</span>
                <small>{madeLabels[artifact.kind] ?? humanize(artifact.kind)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
