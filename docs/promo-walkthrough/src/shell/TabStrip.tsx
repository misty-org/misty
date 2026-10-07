import { cn } from "@/shared/ui";
import {
  AppWindow,
  ArrowRightLeft,
  Bot,
  ChevronDown,
  FolderOpen,
  House,
  Layers,
  PanelBottom,
  PanelBottomClose,
  PanelRight,
  Plus,
  X,
} from "lucide-react";
import { sites } from "../data/project";
import type { AppState, Tab } from "../film/state";
import { GROUP_COLOR, GroupEditor, TabMenu } from "./TabOverlays";

export function SiteMark({ site, className }: { site: keyof typeof sites; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[4px] bg-cream-bright text-[9px] font-bold text-charcoal-bg",
        className,
      )}
    >
      {sites[site].mark}
    </span>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const props = { className: "size-4 shrink-0", strokeWidth: 2, "aria-hidden": true } as const;
  if (tab.kind === "site" && tab.site) return <SiteMark site={tab.site} />;
  if (tab.kind === "space") return <Layers {...props} />;
  if (tab.kind === "explorer") return <FolderOpen {...props} />;
  if (tab.kind === "transfers") return <ArrowRightLeft {...props} />;
  if (tab.kind === "agents") return <Bot {...props} />;
  return <House {...props} />;
}

function TabView({ tab, state, grouped }: { tab: Tab; state: AppState; grouped: boolean }) {
  const active = tab.id === state.active;
  return (
    <div
      data-t={`tab-${tab.id}`}
      className={cn(
        "relative flex h-7 min-w-[80px] flex-[0_1_160px] items-center gap-2 rounded-lg pl-2.5 pr-1.5 text-xs",
        active ? "bg-[#1b1b1b] text-cream-bright" : "text-cream-muted",
        state.tabMenu?.tabId === tab.id && !active && "bg-control-hover",
      )}
      style={
        grouped && active
          ? { boxShadow: `inset 0 2px 0 ${GROUP_COLOR}, inset 2px 0 0 ${GROUP_COLOR}, inset -2px 0 0 ${GROUP_COLOR}` }
          : undefined
      }
    >
      <TabIcon tab={tab} />
      <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      <X className="size-3.5 shrink-0 opacity-70" aria-hidden />
      {state.tabMenu?.tabId === tab.id && <TabMenu menu={state.tabMenu} groupName={state.group?.name} />}
    </div>
  );
}

function GroupBlock({ members, state }: { members: Tab[]; state: AppState }) {
  const reveal = state.group?.reveal ?? 0;
  return (
    <div className="relative flex min-w-0 items-center gap-1" data-t="tab-group">
      <span
        data-t="group-label"
        className="relative shrink-0 whitespace-nowrap rounded-[4px] text-[11px] leading-[18px] font-semibold text-[#202124]"
        style={{ background: GROUP_COLOR, maxWidth: 140 * reveal, padding: `0 ${8 * reveal}px`, opacity: reveal }}
      >
        <span className="block overflow-hidden">{state.group?.name}</span>
      </span>
      {state.groupEditor && <GroupEditor editor={state.groupEditor} />}
      {members.map((tab) => (
        <TabView key={tab.id} tab={tab} state={state} grouped />
      ))}
      <span
        className="pointer-events-none absolute bottom-[-3px] left-0 right-0 h-[2px] rounded-full"
        style={{ background: GROUP_COLOR, opacity: reveal }}
      />
    </div>
  );
}

export function TabStrip({ state }: { state: AppState }) {
  const members = state.group ? state.tabs.filter((tab) => tab.grouped) : [];
  const first = members[0]?.id;
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex h-[38px] items-center pl-[85px] pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {state.tabs.map((tab) =>
          state.group && tab.grouped ? (
            tab.id === first && <GroupBlock key="group" members={members} state={state} />
          ) : (
            <TabView key={tab.id} tab={tab} state={state} grouped={false} />
          ),
        )}
        <span data-t="tab-new" className="grid size-6 shrink-0 place-items-center text-cream-muted">
          <Plus className="size-4" aria-hidden />
        </span>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-1 text-cream-muted">
        {[PanelRight, PanelBottom, PanelBottomClose].map((Icon, index) => (
          <span key={index} className={cn("grid size-6 place-items-center", index === 2 && "opacity-40")}>
            <Icon className="size-4" aria-hidden />
          </span>
        ))}
        <span className="mx-1.5 h-4 w-px bg-charcoal-border" />
        <span className="flex h-6 items-center gap-0.5 px-1">
          <AppWindow className="size-4" aria-hidden />
          <ChevronDown className="size-3" aria-hidden />
        </span>
      </div>
    </div>
  );
}
