import { useState } from "react";
import {
  BookOpen,
  CalendarClock,
  Check,
  CircleAlert,
  Clock,
  FileText,
  FolderOpen,
  Globe,
  LoaderCircle,
  Mail,
  X,
} from "lucide-react";
import { chooseOrganizationFolder } from "@/features/misty/folderOrganization";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, SkeletonList } from "@/shared/ui";
import { taskTemplates, templatePrompt } from "../workspace/taskTemplates";
import { activityStateLabels, formatActivityTime, useAgentActivity } from "./useAgentActivity";
import "./agentLanding.css";

const stateIcon = (state: string) =>
  state === "completed"
    ? Check
    : state === "running"
      ? LoaderCircle
      : state === "queued" || state === "awaiting_device"
        ? Clock
        : state === "canceled"
          ? X
          : CircleAlert;
const appIcon = (app?: string) =>
  app === "Mail"
    ? Mail
    : app === "Calendar"
      ? CalendarClock
      : app === "Browser"
        ? Globe
        : app === "Files"
          ? FileText
          : BookOpen;
const suggested = [1, 0, 7].map((index) => taskTemplates[index]);

/** Under the empty composer: recent work to resume and a few ways to start. */
export function AgentLanding({
  accountId,
  agentId,
  onConversation,
  onUseTemplate,
  onActivity,
  onTemplates,
}: {
  accountId: string;
  agentId: string;
  onConversation(id: string): void;
  onUseTemplate(prompt: string): void;
  onActivity(): void;
  onTemplates(): void;
}) {
  const activity = useAgentActivity(accountId, agentId);
  const [folderError, setFolderError] = useState("");
  const recent = activity.entries
    .filter((entry) => !entry.parent_run_id && entry.conversation_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);
  const canOrganize = hasTauriInternals() && !/Win/.test(navigator.platform);
  const templates = canOrganize ? suggested.slice(0, 2) : suggested;
  return (
    <div className="agent-landing">
      <section aria-labelledby="agent-landing-recent">
        <header>
          <h2 id="agent-landing-recent">Pick up where you left off</h2>
          <Button variant="ghost" size="xs" onClick={onActivity}>
            View all
          </Button>
        </header>
        {recent.map((entry) => {
          const Icon = stateIcon(entry.state);
          return (
            <Button
              key={entry.id}
              variant="ghost"
              justify="start"
              className="agent-landing-row"
              onClick={() => onConversation(entry.conversation_id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{entry.title || "Agent task"}</strong>
                <small>
                  {activityStateLabels[entry.state] ?? entry.state.replace(/_/g, " ")}
                  {" · "}
                  {formatActivityTime(entry.updated_at)}
                </small>
              </span>
            </Button>
          );
        })}
        {!recent.length &&
          (activity.loading ? (
            <SkeletonList label="Recent work" rows={4} leading="icon" rowClassName="px-2" />
          ) : (
            <p className="agent-landing-note">
              {activity.failed ? "Recent work couldn’t load." : "Tasks you start show up here."}
            </p>
          ))}
      </section>
      <section aria-labelledby="agent-landing-templates">
        <header>
          <h2 id="agent-landing-templates">Start from a template</h2>
          <Button variant="ghost" size="xs" onClick={onTemplates}>
            Browse
          </Button>
        </header>
        {canOrganize && (
          <Button
            variant="ghost"
            justify="start"
            className="agent-landing-row"
            onClick={() => {
              setFolderError("");
              void chooseOrganizationFolder(accountId).catch((reason: unknown) =>
                setFolderError(reason instanceof Error ? reason.message : String(reason)),
              );
            }}
          >
            <FolderOpen size={16} aria-hidden="true" />
            <span>
              <strong>Organize a folder</strong>
              <small>{folderError || "Review a cleaner structure before anything moves"}</small>
            </span>
          </Button>
        )}
        {templates.map((template) => {
          const Icon = appIcon(template.apps[0]);
          return (
            <Button
              key={template.name}
              variant="ghost"
              justify="start"
              className="agent-landing-row"
              onClick={() => onUseTemplate(templatePrompt(template))}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{template.name}</strong>
                <small>
                  {template.apps.length ? `Uses ${template.apps.join(" and ")}` : template.category}
                </small>
              </span>
            </Button>
          );
        })}
      </section>
    </div>
  );
}
