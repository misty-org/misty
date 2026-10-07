import mistyLogo from "@/assets/branding/misty-white.png";
import { cn } from "@/shared/ui";
import {
  ArrowRightLeft,
  Bell,
  Bot,
  FolderOpen,
  Folders,
  Globe2,
  House,
  PanelsTopLeft,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { spaces } from "../data/project";

export type RailId =
  | "home"
  | "browser"
  | "agents"
  | "explorer"
  | "transfers"
  | "space-personal"
  | "space-team"
  | "sync"
  | null;

// Geometry follows the 54px global navigator captured from the app: 34px
// tiles, an 18px glyph, trays for Files and Spaces, utilities in the footer.
function Tile(props: {
  id: string;
  top?: number;
  active?: boolean;
  pressed?: boolean;
  marker?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-t={`rail-${props.id}`}
      className={cn(
        "absolute left-[10px] grid size-[34px] place-items-center rounded-lg text-cream-muted",
        props.active && "bg-[#3e3e3e] text-cream-bright",
        props.pressed && "bg-control-hover text-cream",
      )}
      style={props.top === undefined ? undefined : { top: props.top }}
    >
      {props.children}
      {props.marker && (
        <span className="absolute -left-[10px] top-[9px] h-4 w-[3px] rounded-r-full bg-cream" />
      )}
    </div>
  );
}

const glyph = (Icon: LucideIcon) => <Icon className="size-[18px]" strokeWidth={2} aria-hidden />;

function SpaceTile({ label, active }: { label: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "grid size-[26px] place-items-center rounded-[7px] text-[10px] font-semibold",
        active ? "bg-cream-bright text-charcoal-bg" : "bg-[#4a4a4a] text-cream-bright",
      )}
    >
      {label}
    </span>
  );
}

export function Rail({ active, height, pressed }: { active: RailId; height: number; pressed?: string }) {
  const is = (id: RailId) => active === id;
  const press = (id: string) => pressed === `rail-${id}`;
  const footer = (offset: number) => height - offset;
  return (
    <nav className="absolute inset-y-0 left-0 w-[54px] bg-[#101010]" aria-label="Global navigation">
      <div className="absolute left-[11px] top-[39px] grid size-8 place-items-center rounded-lg">
        <img src={mistyLogo} alt="" className="size-[22px] object-contain" />
      </div>
      <div className="absolute left-[14px] top-[76px] h-px w-[26px] bg-charcoal-border" />
      <Tile id="home" top={85} active={is("home")} marker={is("home")} pressed={press("home")}>
        {glyph(House)}
      </Tile>
      <Tile id="browser" top={122} active={is("browser")} marker={is("browser")} pressed={press("browser")}>
        {glyph(Globe2)}
      </Tile>
      <Tile id="agents" top={159} active={is("agents")} marker={is("agents")} pressed={press("agents")}>
        {glyph(Bot)}
      </Tile>
      <div className="absolute left-[8px] top-[196px] h-[116px] w-[38px] rounded-[10px] bg-[#282828]" />
      <Tile id="files" top={199}>{glyph(Folders)}</Tile>
      <Tile id="explorer" top={236} active={is("explorer")} marker={is("explorer")} pressed={press("explorer")}>
        {glyph(FolderOpen)}
      </Tile>
      <Tile id="transfers" top={275} active={is("transfers")} marker={is("transfers")} pressed={press("transfers")}>
        {glyph(ArrowRightLeft)}
      </Tile>
      <Tile id="extensions" top={315}>{glyph(Puzzle)}</Tile>
      <div className="absolute left-[8px] top-[352px] h-[158px] w-[38px] rounded-[10px] bg-[#282828]" />
      <Tile id="spaces" top={355}>{glyph(PanelsTopLeft)}</Tile>
      <Tile id="space-personal" top={392} marker={is("space-personal")} pressed={press("space-personal")}>
        <SpaceTile label={spaces.personal.initials} active={is("space-personal")} />
      </Tile>
      <Tile id="space-team" top={431} marker={is("space-team")} pressed={press("space-team")}>
        <SpaceTile label={spaces.team.initials} active={is("space-team")} />
      </Tile>
      <Tile id="space-create" top={470}>{glyph(Plus)}</Tile>
      <Tile id="search" top={footer(190)}>{glyph(Search)}</Tile>
      <Tile id="activity" top={footer(153)}>{glyph(Bell)}</Tile>
      <Tile id="sync" top={footer(116)} active={is("sync")} pressed={press("sync")}>
        {glyph(RefreshCw)}
      </Tile>
      <Tile id="settings" top={footer(79)}>{glyph(Settings)}</Tile>
      <Tile id="profile" top={footer(42)}>
        <span className="grid size-[26px] place-items-center rounded-[7px] bg-[#5a5a5a] text-[10px] font-semibold text-cream-bright">
          AR
        </span>
      </Tile>
    </nav>
  );
}
