import {
  ActionBar,
  FloatingPanel,
  IconButton,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  PageHeader,
  PathLine,
  SearchField,
  Text,
  type ActionBarItem,
} from "@/shared/ui";
import {
  ArrowUp,
  Copy,
  Cpu,
  Folder,
  GitBranch,
  Layers,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Shield,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection, GalleryStage, GalleryWidths } from "./GalleryLayout";

const models = [
  { id: "deep", name: "Claude with extended thinking, large context" },
  { id: "fast", name: "Fast model" },
];

function useComposerItems(): ActionBarItem[] {
  const [model, setModel] = useState("deep");
  const [auto, setAuto] = useState(true);
  const modelName = models.find((item) => item.id === model)?.name ?? "";
  return [
    { id: "attach", icon: Paperclip, label: "Attach", priority: 3, onSelect: () => {} },
    {
      id: "model",
      icon: Cpu,
      label: modelName,
      priority: 4,
      shrink: true,
      onSelect: () => setModel(model === "deep" ? "fast" : "deep"),
      menu: (
        <MenuRadioGroup value={model} onValueChange={setModel}>
          {models.map((item) => (
            <MenuRadioItem key={item.id} value={item.id} label={item.name} />
          ))}
        </MenuRadioGroup>
      ),
    },
    {
      id: "mode",
      icon: Shield,
      label: "Auto",
      priority: 2,
      pressed: auto,
      onSelect: () => setAuto((value) => !value),
    },
    { id: "share", icon: Share2, label: "Share", shortcut: "⇧⌘S", priority: 1, onSelect: () => {} },
  ];
}

const messageItems: ActionBarItem[] = [
  { id: "copy", icon: Copy, label: "Copy", shortcut: "⌘C", priority: 4, onSelect: () => {} },
  { id: "retry", icon: RotateCcw, label: "Retry", priority: 3, onSelect: () => {} },
  { id: "edit", icon: Pencil, label: "Edit", priority: 2, onSelect: () => {} },
  { id: "like", icon: ThumbsUp, label: "Good answer", priority: 1, onSelect: () => {} },
  {
    id: "delete",
    icon: Trash2,
    label: "Delete",
    priority: 0,
    variant: "danger",
    onSelect: () => {},
  },
];

const pageActions: ActionBarItem[] = [
  { id: "new", icon: Plus, label: "New page", priority: 3, variant: "primary", onSelect: () => {} },
  { id: "share", icon: Share2, label: "Share", priority: 2, onSelect: () => {} },
  {
    id: "delete",
    icon: Trash2,
    label: "Delete",
    priority: 1,
    variant: "danger",
    onSelect: () => {},
  },
];

const pathSegments = [
  { id: "space", icon: Layers, label: "Design team" },
  {
    id: "folder",
    icon: Folder,
    label: "misty-org/misty/src/features/agents",
    menu: <MenuItem icon={Folder} label="Choose another folder…" onSelect={() => {}} />,
  },
  {
    id: "branch",
    icon: GitBranch,
    label: "redesign/design-protocol",
    menu: (
      <>
        <MenuItem icon={GitBranch} label="main" onSelect={() => {}} />
        <MenuItem icon={Plus} label="New branch…" onSelect={() => {}} />
      </>
    ),
  },
];

export function BarsSection() {
  const composerItems = useComposerItems();
  const [panelOpen, setPanelOpen] = useState(true);
  const send = (
    <IconButton label="Send" shortcut="↵" variant="primary">
      <ArrowUp />
    </IconButton>
  );
  return (
    <GallerySection title="Bars and panels">
      <GalleryWidths label="ActionBar md" widths={[560, 380, 240, 140]}>
        {() => <ActionBar label="Composer" items={composerItems} end={send} />}
      </GalleryWidths>
      <GalleryWidths label="ActionBar sm" widths={[420, 200, 96]}>
        {() => <ActionBar label="Message actions" size="sm" items={messageItems} />}
      </GalleryWidths>
      <GalleryWidths label="PathLine" widths={[560, 320, 180]}>
        {() => <PathLine label="Where this chat works" segments={pathSegments} />}
      </GalleryWidths>
      <GalleryWidths label="PageHeader" widths={[640, 420, 260]}>
        {() => (
          <PageHeader
            title="Quarterly planning for the design team"
            actions={pageActions}
            end={
              <SearchField
                containerClassName="w-40"
                placeholder="Search"
                aria-label="Search pages"
              />
            }
          />
        )}
      </GalleryWidths>
      <GalleryRow label="FloatingPanel">
        <GalleryStage className="h-72 w-full max-w-2xl">
          {panelOpen ? (
            <FloatingPanel
              title="Agents in the room"
              anchor="top-left"
              onClose={() => setPanelOpen(false)}
            >
              <div className="grid gap-2 p-3">
                <Text size="body">Three agents are working.</Text>
                <Text size="meta" tone="muted">
                  Studio only: everywhere else panes are flat.
                </Text>
              </div>
            </FloatingPanel>
          ) : (
            <div className="absolute top-3 left-3">
              <IconButton label="Show panel" variant="overlay" onClick={() => setPanelOpen(true)}>
                <Plus />
              </IconButton>
            </div>
          )}
          <FloatingPanel anchor="bottom-right" width="sm">
            <div className="p-3">
              <Text size="meta">A panel without a header</Text>
            </div>
          </FloatingPanel>
        </GalleryStage>
      </GalleryRow>
    </GallerySection>
  );
}
