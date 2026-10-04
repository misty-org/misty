import { cn } from "@/shared/ui";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock,
  Copy,
  Download,
  FileText,
  Folder,
  HardDrive,
  House,
  LayoutGrid,
  List,
  Minus,
  MonitorSmartphone,
  Monitor,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Star,
  Trash2,
  Undo2,
  Ellipsis,
} from "lucide-react";
import { devices } from "../../data/project";
import type { FilesState } from "../../film/state";
import { ExplorerList, listingFor } from "./ExplorerList";

const icon = { className: "size-4", "aria-hidden": true } as const;

function SideRow(props: { label: string; icon: React.ReactNode; active?: boolean; t?: string }) {
  return (
    <div
      data-t={props.t}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm",
        props.active ? "bg-[#282828] text-cream-bright" : "text-cream",
      )}
    >
      <span className="text-cream-muted">{props.icon}</span>
      {props.label}
    </div>
  );
}

function Device(props: { name: string; meta: string; icon: React.ReactNode; active?: boolean; t?: string }) {
  return (
    <div
      data-t={props.t}
      className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5", props.active && "bg-[#282828]")}
    >
      <span className="text-cream-muted">{props.icon}</span>
      <span className="min-w-0">
        <strong className="block text-sm font-medium text-cream-bright">{props.name}</strong>
        <small className="block text-xs text-cream-muted" data-t={props.t ? `${props.t}-meta` : undefined}>
          {props.meta}
        </small>
      </span>
    </div>
  );
}

function Sidebar({ state }: { state: FilesState }) {
  const studio = state.location.startsWith("studio");
  return (
    <aside className="w-[244px] shrink-0 overflow-hidden border-r border-charcoal-border px-3 pt-3">
      <p className="flex items-center gap-1 px-1 pb-1.5 text-sm font-semibold text-cream">
        Quick access <ChevronDown className="size-3.5" />
      </p>
      <SideRow label="Home" icon={<House {...icon} />} active={state.location === "home"} />
      <SideRow label="Desktop" icon={<Monitor {...icon} />} />
      <SideRow label="Documents" icon={<FileText {...icon} />} />
      <SideRow label="Downloads" icon={<Download {...icon} />} />
      <SideRow
        label="Website launch"
        icon={<Folder {...icon} />}
        t="files-qa-launch"
        active={state.location === "documents-launch"}
      />
      <SideRow label="Recent" icon={<Clock {...icon} />} />
      <SideRow label="Starred" icon={<Star {...icon} />} />
      <SideRow label="Trash" icon={<Trash2 {...icon} />} />
      <p className="mt-4 flex items-center gap-1 px-1 pb-1 text-sm font-semibold text-cream">
        Devices <ChevronDown className="size-3.5" />
      </p>
      <p className="flex items-center gap-1 px-2.5 py-1 text-sm font-medium text-cream-muted">
        Local <ChevronDown className="size-3.5" />
      </p>
      <Device name="Macintosh HD" meta="This computer" icon={<HardDrive className="size-5" aria-hidden />} />
      <p className="mt-1 flex items-center gap-1 px-2.5 py-1 text-sm font-medium text-cream-muted">
        Network <ChevronDown className="size-3.5" />
        <Plus className="ml-auto size-3.5" aria-hidden />
      </p>
      <Device
        t="files-studio"
        name={devices.studio}
        meta="Direct · Read-only"
        active={studio}
        icon={<MonitorSmartphone className="size-6" strokeWidth={1.9} aria-hidden />}
      />
    </aside>
  );
}

const crumbs: Record<FilesState["location"], string[]> = {
  home: ["/", "Users", "alex"],
  studio: [devices.studio],
  "studio-launch": [devices.studio, "Website launch"],
  "documents-launch": ["/", "Users", "alex", "Documents", "Website launch"],
};

function Toolbars({ state }: { state: FilesState }) {
  const tool = (Icon: typeof Copy, t?: string, on?: boolean) => (
    <span
      data-t={t}
      className={cn("grid size-8 place-items-center rounded-md text-cream-muted", on && "bg-control-active text-cream")}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
  return (
    <>
      <div className="flex h-12 items-center gap-1 px-3">
        {[ArrowLeft, ArrowRight, ArrowUp, RefreshCw].map((Icon, index) => (
          <span key={index}>{tool(Icon)}</span>
        ))}
        <div className="ml-2 flex h-8 flex-1 items-center gap-2 rounded-lg bg-charcoal-card px-3 text-sm text-cream">
          {crumbs[state.location].map((part, index) => (
            <span key={index} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="size-3.5 text-cream-muted" />}
              {part}
            </span>
          ))}
        </div>
      </div>
      <div className="flex h-11 items-center gap-0.5 border-b border-charcoal-border px-3">
        <span className="mr-2 flex items-center gap-1.5 px-2 text-sm font-medium text-cream">
          <Plus className="size-4" /> New <ChevronDown className="size-3.5" />
        </span>
        {tool(Undo2)}
        {tool(Redo2)}
        {tool(Scissors)}
        {tool(Copy, "files-copy", state.menu?.highlight === "copy")}
        {tool(Clipboard, "files-paste", state.menu?.highlight === "paste")}
        {tool(Pencil)}
        {tool(Trash2)}
        <span className="ml-auto flex items-center gap-0.5">
          {tool(LayoutGrid)}
          {tool(List, undefined, true)}
          {tool(Minus)}
          {tool(Plus)}
          {tool(Ellipsis)}
        </span>
      </div>
    </>
  );
}

export function ExplorerView({ state }: { state: FilesState }) {
  const items = listingFor(state);
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101010]">
      <Toolbars state={state} />
      <div className="flex min-h-0 flex-1">
        <Sidebar state={state} />
        <ExplorerList state={state} items={items} />
      </div>
    </div>
  );
}
