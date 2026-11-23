// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { useState, type ReactNode } from "react";
import { FramedPage } from "@misty/ui";
import { FilesBottomBar } from "./FilesBottomBar";
import type { PaneSlots } from "./FilesPane";
import { useFilesChoices } from "./use_files_browser";

export function FilesFrame({
  picking,
  children,
}: {
  picking: boolean;
  children: (slots: PaneSlots) => ReactNode;
}) {
  const choices = useFilesChoices(picking);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const [inspector, setInspector] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const showPreview = !picking && choices.info;
  const slots: PaneSlots = {
    toolbar,
    sidebar: choices.sidebar ? side : null,
    inspector: showPreview ? inspector : null,
    footer,
  };

  return (
    <FramedPage
      toolbar={<div ref={setToolbar} />}
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
                  <div ref={setSide} className="min-w-0" />
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
            inspector={choices.info}
            onInspector={choices.setInfo}
          />
        )
      }
    >
      {children(slots)}
    </FramedPage>
  );
}
