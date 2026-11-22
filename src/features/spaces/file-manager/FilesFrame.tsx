// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useState, type ReactNode } from "react";
import { FramedPage } from "@misty/ui";
import { FilesBottomBar } from "./FilesBottomBar";
import type { PaneSlots } from "./FilesPane";
import { useFilesChoices } from "./useFilesBrowser";

/**
 * Files in Misty's FramedPage, as Kura's window: its tabs and the active pane's toolbar across the
 * whole width, then the sidebar, the open tab's panes and the preview side by side, parted by seams and
 * resized by dragging them, then the bottom bar with the sidebar's and the preview's toggles. The active pane draws its own toolbar, sidebar and
 * preview into the slots it is handed. The picker keeps a slot for its buttons where the bottom bar
 * would be.
 */
export function FilesFrame({
  picking,
  tabs,
  sidebarTop,
  sidebar,
  preview = true,
  children,
}: {
  picking: boolean;
  /** Kura's tab row, over everything. */
  tabs?: ReactNode;
  /** What leads the sidebar: Kura's workspace switcher. */
  sidebarTop?: ReactNode;
  /** The sidebar's rows when no pane draws them (the Transfers tab). */
  sidebar?: ReactNode;
  /** Whether the open tab has a preview to show (Transfers has none). */
  preview?: boolean;
  /** The open tab's panes, handed the slots. */
  children: (slots: PaneSlots) => ReactNode;
}) {
  const choices = useFilesChoices(picking);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const [inspector, setInspector] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const showPreview = preview && !picking && choices.info;
  const slots: PaneSlots = {
    toolbar,
    sidebar: choices.sidebar ? side : null,
    inspector: showPreview ? inspector : null,
    footer,
  };

  return (
    <FramedPage
      toolbar={[tabs, <div key="toolbar" ref={setToolbar} />]}
      autoSaveId={picking ? "files-picker" : "files-browser"}
      start={
        choices.sidebar
          ? {
              id: "files-sidebar",
              label: "Resize the sidebar",
              defaultSize: 20,
              minSize: 12,
              maxSize: 32,
              content: (
                <div className="flex size-full flex-col gap-3 overflow-y-auto p-3">
                  {sidebarTop}
                  {sidebar ?? <div ref={setSide} className="min-w-0" />}
                </div>
              ),
            }
          : null
      }
      end={
        showPreview
          ? {
              id: "files-inspector",
              label: "Resize the preview",
              defaultSize: 28,
              minSize: 18,
              maxSize: 45,
              content: <div ref={setInspector} className="size-full min-h-0" />,
            }
          : null
      }
      footer={
        picking ? (
          <div ref={setFooter} className="shrink-0" />
        ) : (
          <FilesBottomBar
            sidebar={choices.sidebar}
            onSidebar={choices.setSidebar}
            inspector={preview ? choices.info : undefined}
            onInspector={preview ? choices.setInfo : undefined}
          />
        )
      }
    >
      {children(slots)}
    </FramedPage>
  );
}
