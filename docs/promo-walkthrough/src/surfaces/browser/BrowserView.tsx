import { cn } from "@/shared/ui";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Download,
  Ellipsis,
  Lock,
  Monitor,
  Pencil,
  Puzzle,
  RotateCw,
  Star,
} from "lucide-react";
import { sites } from "../../data/project";
import type { BrowserState } from "../../film/state";
import { SiteMark } from "../../shell/TabStrip";
import { ChecklistSite, ImagesSite } from "./sites/Articles";
import { CmsSite } from "./sites/Cms";
import { StagingSite } from "./sites/Staging";

const icon = { className: "size-4", strokeWidth: 2, "aria-hidden": true } as const;

function ToolbarButton({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <span className={cn("grid size-7 place-items-center rounded-md text-cream-muted", dim && "opacity-40")}>
      {children}
    </span>
  );
}

function Omnibox({ state }: { state: BrowserState }) {
  const site = sites[state.site];
  const editing = state.address !== undefined;
  return (
    <div
      data-t="omnibox"
      className={cn(
        "relative flex h-[30px] min-w-0 flex-1 items-center rounded-md px-3 text-[13px]",
        editing ? "bg-charcoal-card ring-1 ring-cream/15" : "bg-cream/[0.045]",
      )}
    >
      {editing ? (
        <span className="flex min-w-0 items-center text-cream-bright">
          {state.address}
          <span className="ml-px inline-block h-4 w-px bg-cream-bright" />
        </span>
      ) : (
        <span className="flex w-full min-w-0 items-center justify-center gap-2 text-cream-muted">
          <SiteMark site={state.site} className="size-3.5 text-[8px]" />
          <span className="truncate">{site.title}</span>
        </span>
      )}
      {state.loading !== undefined && state.loading < 1 && (
        <span
          className="absolute bottom-0 left-0 h-[2px] rounded-full bg-cream/60"
          style={{ width: `${state.loading * 100}%` }}
        />
      )}
    </div>
  );
}

function Page({ state }: { state: BrowserState }) {
  switch (state.site) {
    case "staging":
      return <StagingSite message={state.contactMessage} caret={state.caret} />;
    case "checklist":
      return <ChecklistSite />;
    case "images":
      return <ImagesSite />;
    case "cms":
      return <CmsSite />;
  }
}

export function BrowserView({ state }: { state: BrowserState }) {
  const blank = state.loading !== undefined && state.loading < 0.35;
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#101010]">
      <div data-browser-toolbar className="flex h-11 shrink-0 items-center gap-2 border-b border-cream/[0.055] px-2.5">
        <div className="flex items-center gap-0.5">
          <ToolbarButton>
            <ArrowLeft {...icon} />
          </ToolbarButton>
          <ToolbarButton dim>
            <ArrowRight {...icon} />
          </ToolbarButton>
          <ToolbarButton>
            <RotateCw {...icon} />
          </ToolbarButton>
        </div>
        <ToolbarButton>
          <Lock {...icon} className="size-3.5" />
        </ToolbarButton>
        <Omnibox state={state} />
        <ToolbarButton>
          <Star {...icon} />
        </ToolbarButton>
        <div className="flex items-center gap-0.5">
          {[Pencil, Monitor, Bot, Puzzle, Download, Ellipsis].map((Icon, index) => (
            <ToolbarButton key={index}>
              <Icon {...icon} />
            </ToolbarButton>
          ))}
        </div>
      </div>
      <div className={cn("relative min-h-0 flex-1 overflow-hidden", state.address !== undefined ? "bg-[#101010]" : "bg-white")} data-t="page">
        {!blank && (
          <div style={{ transform: `translateY(${-state.scroll}px)` }}>
            <Page state={state} />
          </div>
        )}
      </div>
    </div>
  );
}
