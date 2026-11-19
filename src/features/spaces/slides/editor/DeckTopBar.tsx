import {
  ChevronRight,
  FileDown,
  FolderOpen,
  HardDrive,
  History,
  ImageIcon,
  LayoutTemplate,
  MoreHorizontal,
  Palette,
  Play,
  Presentation,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActionBar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  Input,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Surface,
  Text,
  spaceIcons,
  useNotice,
  type ActionBarItem,
  type ActionBarMode,
} from "@/shared/ui";
import { EmbedPicker, type EmbedReference } from "@/features/spaces/embeds";
import type { ItemVisibility } from "../../api/visibility";
import { slideLayouts } from "../deck/layouts";
import { deckThemeList } from "../deck/themes";
import { slideLayoutIds, type DeckThemeId, type SlideLayoutId } from "../deck/types";
import type { DeckPeer } from "../hooks/useDeckPresence";
import { LayoutPicker, ThemePicker } from "./DeckPickers";
import { PresenceAvatars } from "./PresenceAvatars";

export type DeckPopover = "layout" | "theme" | "chart" | "frame" | null;

export interface DeckTopBarProps {
  title: string;
  canEdit: boolean;
  canRename: boolean;
  canDelete: boolean;
  spaceId: string;
  hostVisibility: ItemVisibility;
  hostCreatorId: string;
  layout: SlideLayoutId | null;
  theme: DeckThemeId;
  peers: DeckPeer[];
  hasSlides: boolean;
  exporting: boolean;
  open: DeckPopover;
  onOpen(open: DeckPopover): void;
  onBack(): void;
  onRename(title: string): Promise<void>;
  onLayout(layout: SlideLayoutId): void;
  onTheme(theme: DeckThemeId): void;
  onImage(source: "computer" | "library"): void;
  onEmbed(embed: EmbedReference): void;
  onExport(format: "pptx" | "pdf"): void;
  onHistory(): void;
  onDelete(): void;
  onPresent(): void;
}

/** The deck's one thin bar: where it is, the slide tools, who's here, ⋯ and Present. */
export function DeckTopBar(props: DeckTopBarProps) {
  const items: ActionBarItem[] = props.canEdit && props.hasSlides ? toolItems(props) : [];
  return (
    <Surface
      as="header"
      tone="page"
      className="flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pr-3 pl-1"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Button
          variant="quiet"
          icon={Presentation}
          onClick={props.onBack}
          aria-label="Back to slides"
        >
          Slides
        </Button>
        <Text bare tone="muted" className="shrink-0">
          <ChevronRight aria-hidden="true" />
        </Text>
        <DeckTitleField title={props.title} canRename={props.canRename} onRename={props.onRename} />
      </div>
      {items.length ? <ActionBar label="Slide tools" width="content" items={items} /> : null}
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <PresenceAvatars peers={props.peers} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More">
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="md">
            <MenuSubmenu
              icon={FileDown}
              label="Export"
              disabled={!props.hasSlides || props.exporting}
            >
              <MenuItem label="PowerPoint (.pptx)" onSelect={() => props.onExport("pptx")} />
              <MenuItem label="PDF" onSelect={() => props.onExport("pdf")} />
            </MenuSubmenu>
            <MenuItem icon={History} label="Version history" onSelect={props.onHistory} />
            {props.canDelete ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete deck" danger onSelect={props.onDelete} />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {props.hasSlides ? (
          <span data-tour="deck-present" className="contents">
            <Button variant="primary" icon={Play} onClick={props.onPresent}>
              Present
            </Button>
          </span>
        ) : null}
      </div>
    </Surface>
  );
}

function toolItems(props: DeckTopBarProps): ActionBarItem[] {
  const toggle = (which: Exclude<DeckPopover, null>) => (open: boolean) =>
    props.onOpen(open ? which : props.open === which ? null : props.open);
  const button = (mode: ActionBarMode, label: string, Icon: typeof Palette) =>
    mode === "full" ? (
      <Button variant="quiet" icon={Icon}>
        {label}
      </Button>
    ) : (
      <IconButton label={label}>
        <Icon />
      </IconButton>
    );
  return [
    {
      id: "layout",
      icon: LayoutTemplate,
      label: "Layout",
      priority: 5,
      onSelect: () => props.onOpen("layout"),
      menu: (
        <MenuRadioGroup
          value={props.layout ?? ""}
          onValueChange={(value) => props.onLayout(value as SlideLayoutId)}
        >
          {slideLayoutIds.map((id) => (
            <MenuRadioItem key={id} value={id} label={slideLayouts[id].name} />
          ))}
        </MenuRadioGroup>
      ),
      render: (mode) => (
        <span data-tour="deck-layout" className="contents">
          <Popover open={props.open === "layout"} onOpenChange={toggle("layout")}>
            <PopoverTrigger asChild>{button(mode, "Layout", LayoutTemplate)}</PopoverTrigger>
            <PopoverContent size="lg" align="start">
              <PopoverHeader title="Layout" />
              <PopoverBody>
                <LayoutPicker
                  value={props.layout}
                  onPick={(layout) => {
                    props.onLayout(layout);
                    props.onOpen(null);
                  }}
                />
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </span>
      ),
    },
    {
      id: "theme",
      icon: Palette,
      label: "Theme",
      priority: 4,
      onSelect: () => props.onOpen("theme"),
      menu: (
        <MenuRadioGroup
          value={props.theme}
          onValueChange={(value) => props.onTheme(value as DeckThemeId)}
        >
          {deckThemeList.map((theme) => (
            <MenuRadioItem key={theme.id} value={theme.id} label={theme.name} />
          ))}
        </MenuRadioGroup>
      ),
      render: (mode) => (
        <span data-tour="deck-theme" className="contents">
          <Popover open={props.open === "theme"} onOpenChange={toggle("theme")}>
            <PopoverTrigger asChild>{button(mode, "Theme", Palette)}</PopoverTrigger>
            <PopoverContent size="lg" align="start">
              <PopoverHeader title="Theme" />
              <PopoverBody>
                <ThemePicker value={props.theme} onPick={props.onTheme} />
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </span>
      ),
    },
    {
      id: "image",
      icon: ImageIcon,
      label: "Image",
      priority: 3,
      onSelect: () => props.onImage("computer"),
      menu: <ImageMenuRows onImage={props.onImage} />,
      render: () => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Image">
              <ImageIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width="md">
            <ImageMenuRows onImage={props.onImage} />
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
    {
      id: "chart",
      icon: spaceIcons.data,
      label: "Chart from Data",
      priority: 2,
      onSelect: () => props.onOpen("chart"),
      render: () => (
        <EmbedPicker
          spaceId={props.spaceId}
          hostVisibility={props.hostVisibility}
          hostCreatorId={props.hostCreatorId}
          kinds={["data-chart", "data-range"]}
          open={props.open === "chart"}
          onOpenChange={toggle("chart")}
          onPick={(embed) => {
            props.onEmbed(embed);
            props.onOpen(null);
          }}
        >
          <IconButton label="Chart from Data">
            <spaceIcons.data />
          </IconButton>
        </EmbedPicker>
      ),
    },
    {
      id: "frame",
      icon: spaceIcons.whiteboards,
      label: "Whiteboard frame",
      priority: 1,
      onSelect: () => props.onOpen("frame"),
      render: () => (
        <EmbedPicker
          spaceId={props.spaceId}
          hostVisibility={props.hostVisibility}
          hostCreatorId={props.hostCreatorId}
          kinds={["board-frame"]}
          open={props.open === "frame"}
          onOpenChange={toggle("frame")}
          onPick={(embed) => {
            props.onEmbed(embed);
            props.onOpen(null);
          }}
        >
          <IconButton label="Whiteboard frame">
            <spaceIcons.whiteboards />
          </IconButton>
        </EmbedPicker>
      ),
    },
  ];
}

function ImageMenuRows(props: { onImage(source: "computer" | "library"): void }): ReactNode {
  return (
    <>
      <MenuItem
        icon={HardDrive}
        label="From this computer"
        onSelect={() => props.onImage("computer")}
      />
      <MenuItem
        icon={FolderOpen}
        label="From Space media"
        onSelect={() => props.onImage("library")}
      />
    </>
  );
}

/** The deck's title, renamed in place: Enter saves, and a failed save says so. */
function DeckTitleField(props: {
  title: string;
  canRename: boolean;
  onRename(title: string): Promise<void>;
}) {
  const [title, setTitle] = useState(props.title);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelled = useRef(false);
  useNotice(failed, {
    message: "Title not saved. Press Enter in the title to try again.",
    tone: "error",
    onDismiss: () => setFailed(false),
  });
  useEffect(() => {
    setTitle(props.title);
    setFailed(false);
  }, [props.title]);

  const save = async () => {
    if (saving || !props.canRename) return;
    const next = title.trim() || "Untitled deck";
    setTitle(next);
    if (next === props.title) return;
    setSaving(true);
    setFailed(false);
    try {
      await props.onRename(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Input
      value={title}
      aria-label="Deck title"
      aria-invalid={failed || undefined}
      readOnly={saving || !props.canRename}
      className="max-w-md px-2 text-sm font-semibold shadow-none"
      onChange={(event) => {
        setTitle(event.target.value);
        setFailed(false);
      }}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          // Leaving the field saves it.
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setTitle(props.title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
