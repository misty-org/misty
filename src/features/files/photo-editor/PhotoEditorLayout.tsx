import type { ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { IconButton, Separator, SplitHandle, Surface } from "@misty/ui";
import {
  Blend,
  Bot,
  Crop,
  Pencil,
  Scaling,
  Scissors,
  SlidersHorizontal,
  Sticker,
  Type,
} from "lucide-react";

export type PhotoTab =
  "agent" | "adjust" | "filters" | "crop" | "markup" | "text" | "stickers" | "size" | "cutout";

/** The tabs that mark the image: each puts the marks under the pointer to pick and move. */
export const markingTabs: readonly PhotoTab[] = ["markup", "text", "stickers"];

/** The rail's tabs, in OpenCut's order of use: the agent first, then the edit as it is made. */
export const photoTabs: Record<PhotoTab, { label: string; icon: typeof Bot; shortcut?: string }> = {
  agent: { label: "Agent", icon: Bot },
  adjust: { label: "Adjust", icon: SlidersHorizontal },
  filters: { label: "Filters", icon: Blend },
  crop: { label: "Crop", icon: Crop, shortcut: "C" },
  markup: { label: "Markup", icon: Pencil },
  text: { label: "Text", icon: Type, shortcut: "T" },
  stickers: { label: "Stickers", icon: Sticker },
  size: { label: "Size", icon: Scaling },
  cutout: { label: "Remove background", icon: Scissors },
};

/** One pane of the editor, as OpenCut draws its panels: the page's fill inside a hairline. */
function EditorPane(props: { children: ReactNode; label?: string }) {
  return (
    <Surface
      as="section"
      aria-label={props.label}
      tone="page"
      edge="hairline"
      radius="sm"
      className="flex size-full min-h-0 min-w-0 overflow-hidden"
    >
      {props.children}
    </Surface>
  );
}

/** The tools pane: OpenCut's rail of tabs down its side, and the open tab beside it. */
export function PhotoToolsPane(props: {
  tabs: PhotoTab[];
  active: PhotoTab;
  onPick: (tab: PhotoTab) => void;
  children: ReactNode;
}) {
  return (
    <EditorPane>
      <div
        role="toolbar"
        aria-label="Tools"
        aria-orientation="vertical"
        className="flex shrink-0 flex-col items-center gap-0.5 overflow-y-auto p-1"
      >
        {props.tabs.map((tab) => {
          const { label, icon: Icon, shortcut } = photoTabs[tab];
          return (
            <IconButton
              key={tab}
              label={label}
              shortcut={shortcut}
              tooltipSide="right"
              aria-pressed={props.active === tab}
              onClick={() => props.onPick(tab)}
            >
              <Icon />
            </IconButton>
          );
        })}
      </div>
      <Separator orientation="vertical" />
      <div className="min-h-0 min-w-0 flex-1">{props.children}</div>
    </EditorPane>
  );
}

/** The image's pane: the image as large as it fits, and its view controls under it. */
export function PhotoPreviewPane(props: { children: ReactNode; controls: ReactNode }) {
  return (
    <EditorPane label="Image">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">{props.children}</div>
        <div
          role="toolbar"
          aria-label="View"
          className="flex h-11 shrink-0 items-center justify-between gap-1 px-2"
        >
          {props.controls}
        </div>
      </div>
    </EditorPane>
  );
}

/** The properties pane on the right. */
export function PhotoPropertiesPane(props: { children: ReactNode }) {
  return (
    <EditorPane>
      <div className="min-h-0 min-w-0 flex-1">{props.children}</div>
    </EditorPane>
  );
}

/**
 * The photo editor laid out as OpenCut lays out its editor, without the timeline: the tools, the
 * image and the properties side by side, each seam draggable, at OpenCut's 25, 50 and 25. Someone
 * who can only view the image sees it alone.
 */
export function PhotoEditorLayout(props: {
  tools?: ReactNode;
  preview: ReactNode;
  properties?: ReactNode;
}) {
  if (!props.tools || !props.properties)
    return <div className="flex size-full min-h-0 px-3">{props.preview}</div>;
  return (
    <PanelGroup direction="horizontal" autoSaveId="misty-photo-editor" className="size-full px-3">
      <Panel defaultSize={25} minSize={15} maxSize={40} className="min-w-0">
        {props.tools}
      </Panel>
      <SplitHandle direction="horizontal" label="Resize tools and image" />
      <Panel defaultSize={50} minSize={30} className="min-h-0 min-w-0">
        {props.preview}
      </Panel>
      <SplitHandle direction="horizontal" label="Resize image and properties" />
      <Panel defaultSize={25} minSize={15} maxSize={40} className="min-w-0">
        {props.properties}
      </Panel>
    </PanelGroup>
  );
}
