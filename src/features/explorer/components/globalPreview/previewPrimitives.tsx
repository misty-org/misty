import { Button } from "@/ui";
import { FileArchive } from "lucide-react";
import type { ArchiveEntry } from "@/models/interfaces/services/misty-api";
import { formatBytes } from "../../utils/fileFormat";

export function ArchiveReader(props: { entries: ArchiveEntry[]; format: string }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-2 p-8">
      <div className="mb-3 flex items-center gap-3">
        <FileArchive size={26} />
        <div>
          <strong className="block">{props.format.toUpperCase()} archive</strong>
          <span className="text-xs text-muted-foreground">
            {props.entries.length} visible entries
          </span>
        </div>
      </div>
      {props.entries.map((entry, index) => (
        <div
          key={`${entry.path}:${index}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <span className="truncate">{entry.path}</span>
          <span className="text-muted-foreground">
            {entry.isDir ? "Folder" : formatBytes(entry.uncompressedSize)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PreviewMessage(props: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center p-8 text-center">
      <div className="grid max-w-md justify-items-center gap-3 text-muted-foreground">
        {props.icon}
        <strong className="text-base text-foreground">{props.title}</strong>
        <p className="m-0 text-sm leading-6">{props.detail}</p>
        {props.action}
      </div>
    </div>
  );
}

export function ToolbarButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

export function InspectorDetail(props: { label: string; value: string; compact?: boolean }) {
  if (props.compact)
    return (
      <div>
        <dt className="text-[10px] font-medium text-muted-foreground">{props.label}</dt>
        <dd className="m-0 mt-0.5 break-words text-[11px] leading-4 text-foreground/80">
          {props.value}
        </dd>
      </div>
    );
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {props.label}
      </dt>
      <dd className="m-0 mt-1 break-words text-sm leading-5 text-foreground/80">{props.value}</dd>
    </div>
  );
}
