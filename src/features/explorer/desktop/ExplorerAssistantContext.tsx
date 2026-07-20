import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, File, Folder, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { errorText } from "@/shared/format";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import type { AiStatus } from "../../../stores/useMikaSessionStore";
import { assistantPanelStyles } from "./ExplorerAssistantStyles";
import { mikaSelectionSummary } from "./ExplorerAssistantShared";

export function MikaContextContent(props: {
  status: AiStatus | null;
  workingDirectory: string;
  selectedPaths: string[];
}) {
  const configured = props.status?.configured ?? false;
  const statusLabel = props.status ? (configured ? "Ready" : "Not configured") : "Checking";
  const statusMeta = props.status && configured ? props.status.modelName : "";
  const selectionText = props.selectedPaths.length > 0 ? props.selectedPaths.join("\n") : "";
  const firstSelection = props.selectedPaths[0] ?? "";
  return (
    <div className="grid gap-3">
      <ContextSection label="Status">
        <div className="grid grid-cols-[20px_minmax(0,1fr)] items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${configured ? "bg-emerald-500" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-sm font-medium">
            {statusLabel}
            {statusMeta ? (
              <small className="ml-2 font-normal text-muted-foreground">{statusMeta}</small>
            ) : null}
          </span>
        </div>
      </ContextSection>
      <ContextSection label="Working directory">
        <ContextValue
          icon={<Folder size={18} />}
          value={props.workingDirectory || "No active folder"}
          copyValue={props.workingDirectory}
          copyLabel="Working directory"
        />
      </ContextSection>
      <ContextSection label="Selection">
        <ContextValue
          icon={<File size={18} />}
          value={mikaSelectionSummary(props.selectedPaths)}
          detail={firstSelection}
          copyValue={selectionText}
          copyLabel="Selection"
        />
      </ContextSection>
    </div>
  );
}

export function MikaEmptyState() {
  return (
    <div className={assistantPanelStyles.mikaEmpty}>
      <div className={assistantPanelStyles.mikaEmptyInner}>
        <span className={assistantPanelStyles.mikaEmptyIcon}>
          <MessageSquare size={34} strokeWidth={1.5} />
          <Sparkles className={assistantPanelStyles.mikaEmptySpark} size={17} />
        </span>
        <h3 className={assistantPanelStyles.mikaEmptyTitle}>Ask Mika</h3>
        <p className={assistantPanelStyles.mikaEmptyText}>
          Start with the current folder or selected files.
        </p>
      </div>
    </div>
  );
}

function ContextSection(props: { label: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-1.5 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      {props.children}
    </section>
  );
}

function ContextValue(props: {
  icon: React.ReactNode;
  value: string;
  detail?: string;
  copyValue: string;
  copyLabel: string;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)_32px] items-center gap-2">
      <span className="text-muted-foreground">{props.icon}</span>
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-medium" title={props.value}>
          {props.value}
        </strong>
        {props.detail ? (
          <small className="truncate text-xs text-muted-foreground" title={props.detail}>
            {props.detail}
          </small>
        ) : null}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        type="button"
        aria-label={`Copy ${props.copyLabel.toLocaleLowerCase()}`}
        disabled={!props.copyValue}
        onClick={() => void copyMikaContextValue(props.copyValue, props.copyLabel)}
      >
        <Copy size={15} />
      </Button>
    </div>
  );
}

async function copyMikaContextValue(value: string, label: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    await writeText(trimmed);
    useExplorerStore.getState().pushNotification(`${label} copied.`, "success");
  } catch (error) {
    useExplorerStore.getState().pushNotification(errorText(error), "error");
  }
}
