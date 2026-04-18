import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./noteBlockEditor.css";

import type { NoteBodyFormat } from "@/models/types/features/notes/types";
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type Block,
} from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { withCollaboration } from "@blocknote/core/yjs";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { useBlockNoteEditor, useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useAppThemeStore } from "@/stores/app/useAppThemeStore";
import { cn } from "@/ui";
import type { NoteCollaborationSession } from "@/features/notes/noteCollaboration";
import {
  acquireNoteCollaborationSession,
  releaseNoteCollaborationSession,
} from "@/features/notes/noteCollaboration";
import { resolveNoteAssetUrl, uploadNoteAsset } from "@/features/notes/noteAssets";
import { usePointerDrag, type PointerDragPayload } from "@/features/dnd/PointerDragContext";

const mistyNotesSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
});

const NOTE_BLOCK_DRAG_KIND = "note-block";

interface NoteBlockEditorProps {
  editable: boolean;
  collaborative?: boolean;
  noteId: string;
  accountId?: string;
  spaceId?: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
  autoFocus?: boolean;
  onContentChange?: (content: {
    body: string;
    bodyFormat: "blocknote-json";
    bodyMarkdown: string;
  }) => void;
}

export function NoteBlockEditor(props: NoteBlockEditorProps) {
  if (props.collaborative && props.spaceId) {
    return <CollaborativeNoteBlockEditor {...props} spaceId={props.spaceId} />;
  }

  return <LocalNoteBlockEditor {...props} />;
}

function LocalNoteBlockEditor(props: NoteBlockEditorProps) {
  const editor = useCreateBlockNote({
    schema: mistyNotesSchema,
    uploadFile: (file) =>
      uploadNoteAsset({
        accountId: props.accountId,
        spaceId: props.spaceId,
        noteId: props.noteId,
        file,
      }),
    resolveFileUrl: resolveNoteAssetUrl,
  });
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const loadedContentRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const onContentChangeRef = useRef(props.onContentChange);
  const blockDropZoneRef = useNoteBlockPointerDropZones(editor, props.editable);

  useEffect(() => {
    onContentChangeRef.current = props.onContentChange;
  }, [props.onContentChange]);

  useEffect(() => {
    const contentKey = [props.bodyFormat, props.body, props.bodyMarkdown ?? ""].join("\u0000");
    if (loadedContentRef.current === contentKey) return;
    loadingRef.current = true;
    try {
      const blocks =
        props.bodyFormat === "blocknote-json"
          ? JSON.parse(props.body)
          : editor.tryParseMarkdownToBlocks(props.bodyMarkdown ?? props.body);
      editor.replaceBlocks(editor.document, blocks);
      loadedContentRef.current = contentKey;
    } catch {
      const blocks = editor.tryParseMarkdownToBlocks(props.bodyMarkdown ?? "");
      editor.replaceBlocks(editor.document, blocks);
      loadedContentRef.current = contentKey;
    } finally {
      loadingRef.current = false;
    }
  }, [editor, props.body, props.bodyFormat, props.bodyMarkdown]);

  useEffect(() => {
    if (!props.editable || !props.autoFocus) return;
    const frame = window.requestAnimationFrame(() => editor.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editor, props.autoFocus, props.editable]);

  const handleChange = useCallback(() => {
    if (loadingRef.current) return;
    const body = JSON.stringify(editor.document);
    const bodyMarkdown = editor.blocksToMarkdownLossy(editor.document);
    loadedContentRef.current = ["blocknote-json", body, bodyMarkdown].join("\u0000");
    onContentChangeRef.current?.({
      body,
      bodyFormat: "blocknote-json",
      bodyMarkdown,
    });
  }, [editor]);

  return (
    <div
      ref={blockDropZoneRef}
      className={cn("misty-note-block-editor", !props.editable && "is-readonly")}
      data-misty-window-drag-block="true"
      data-pointer-drag-source={props.editable ? "true" : undefined}
    >
      {props.editable ? <div className="misty-note-block-drop-gutter" aria-hidden="true" /> : null}
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        onChange={props.editable ? handleChange : undefined}
        theme={resolvedTheme}
      >
        {props.editable ? <MistyBlockPointerDragBridge /> : null}
      </BlockNoteView>
    </div>
  );
}

function CollaborativeNoteBlockEditor(props: NoteBlockEditorProps & { spaceId: string }) {
  const [session, setSession] = useState<NoteCollaborationSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError(null);

    acquireNoteCollaborationSession(props.spaceId, props.noteId)
      .then((nextSession) => {
        if (active) setSession(nextSession);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Could not connect to this note.");
      });

    return () => {
      active = false;
      releaseNoteCollaborationSession(props.spaceId, props.noteId);
    };
  }, [props.noteId, props.spaceId]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Note collaboration unavailable.
      </div>
    );
  }

  if (!session) {
    return <div className="px-2 py-3 text-sm text-muted-foreground">Connecting note...</div>;
  }

  return (
    <CollaborativeBlockNoteRoom
      key={`${props.noteId}:${session.ticket.room}`}
      {...props}
      session={session}
    />
  );
}

function CollaborativeBlockNoteRoom(
  props: NoteBlockEditorProps & { spaceId: string; session: NoteCollaborationSession },
) {
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: mistyNotesSchema,
      uploadFile: (file) =>
        uploadNoteAsset({
          accountId: props.accountId,
          spaceId: props.spaceId,
          noteId: props.noteId,
          file,
        }),
      resolveFileUrl: resolveNoteAssetUrl,
      collaboration: {
        fragment: props.session.fragment,
        provider: props.session.provider,
        user: collaborationUser(props.accountId),
      },
    }),
  );

  useEffect(() => {
    if (!props.editable || !props.autoFocus) return;
    const frame = window.requestAnimationFrame(() => editor.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editor, props.autoFocus, props.editable]);

  const editable = props.editable && props.session.ticket.role !== "viewer";
  const blockDropZoneRef = useNoteBlockPointerDropZones(editor, editable);

  return (
    <div
      ref={blockDropZoneRef}
      className={cn("misty-note-block-editor", !editable && "is-readonly")}
      data-misty-window-drag-block="true"
      data-pointer-drag-source={editable ? "true" : undefined}
    >
      {editable ? <div className="misty-note-block-drop-gutter" aria-hidden="true" /> : null}
      <BlockNoteView editor={editor} editable={editable} theme={resolvedTheme}>
        {editable ? <MistyBlockPointerDragBridge /> : null}
      </BlockNoteView>
    </div>
  );
}

function MistyBlockPointerDragBridge() {
  const editor = useBlockNoteEditor();
  const { startDrag, state } = usePointerDrag();
  const armedElementRef = useRef<HTMLElement | null>(null);
  const armedHandleRef = useRef<{ button: HTMLButtonElement; pointerId: number } | null>(null);

  useEffect(() => {
    const container = editor.prosemirrorView.dom.closest(".bn-container");
    if (!container) return;

    const dragHandleButton = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const button = target.closest<HTMLButtonElement>(".bn-side-menu button");
      return button?.querySelector("[data-test='dragHandle']") ? button : null;
    };

    const prepareNativeHandle = () => {
      container
        .querySelectorAll<HTMLElement>(".bn-side-menu [data-test='dragHandle']")
        .forEach((icon) => {
          const button = icon.closest("button");
          if (!button) return;
          if (button.draggable) button.draggable = false;
          button.dataset.mistyBlockDragHandle = "true";
          button.dataset.mistyWindowDragBlock = "true";
          button.dataset.pointerDragSource = "true";
        });
    };
    prepareNativeHandle();
    const observer = new MutationObserver(prepareNativeHandle);
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["draggable"],
      childList: true,
      subtree: true,
    });

    const onPointerDown = (event: globalThis.PointerEvent) => {
      const activeBlock = editor.getExtension(SideMenuExtension)?.store.state?.block;
      const button = dragHandleButton(event.target);
      if (!editor.isEditable || !activeBlock || !button || !editor.isWithinEditor(button)) return;
      // Disable WebKit's native drag before it has a chance to issue
      // pointercancel and abort the pointer-based drag.
      button.draggable = false;
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
        armedHandleRef.current = { button, pointerId: event.pointerId };
      } catch {
        armedHandleRef.current = null;
      }
      setNoteBlockDragHighlight(armedElementRef.current, false);
      const sourceElement = noteBlockElement(editor.prosemirrorView.dom, activeBlock.id);
      setNoteBlockDragHighlight(sourceElement, true);
      armedElementRef.current = sourceElement;
      startDrag(
        event as unknown as PointerEvent<HTMLElement>,
        { kind: NOTE_BLOCK_DRAG_KIND, id: activeBlock.id },
        <NoteBlockDragPreview block={activeBlock} />,
      );
    };
    const clearArmedHighlight = () => {
      setNoteBlockDragHighlight(armedElementRef.current, false);
      armedElementRef.current = null;
      const armedHandle = armedHandleRef.current;
      armedHandleRef.current = null;
      if (!armedHandle) return;
      try {
        if (armedHandle.button.hasPointerCapture(armedHandle.pointerId)) {
          armedHandle.button.releasePointerCapture(armedHandle.pointerId);
        }
      } catch {}
    };
    const stopNativeDrag = (event: Event) => {
      const button = dragHandleButton(event.target);
      if (button && editor.isWithinEditor(button)) event.preventDefault();
    };

    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
    document.addEventListener("pointerup", clearArmedHighlight, true);
    document.addEventListener("pointercancel", clearArmedHighlight, true);
    document.addEventListener("dragstart", stopNativeDrag, true);
    return () => {
      observer.disconnect();
      clearArmedHighlight();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", clearArmedHighlight, true);
      document.removeEventListener("pointercancel", clearArmedHighlight, true);
      document.removeEventListener("dragstart", stopNativeDrag, true);
    };
  }, [editor, startDrag]);

  useEffect(() => {
    if (state.payload?.kind !== NOTE_BLOCK_DRAG_KIND) return;
    const draggedElement = noteBlockElement(editor.prosemirrorView.dom, state.payload.id);
    setNoteBlockDragHighlight(draggedElement, true);
    editor.getExtension(SideMenuExtension)?.freezeMenu();
    return () => {
      setNoteBlockDragHighlight(draggedElement, false);
      editor.getExtension(SideMenuExtension)?.unfreezeMenu();
    };
  }, [editor, state.payload]);

  return null;
}

function NoteBlockDragPreview({ block }: { block: Block<any, any, any> }) {
  return (
    <div className="max-w-[260px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-lg">
      {blockPreviewText(block)}
    </div>
  );
}

function useNoteBlockPointerDropZones(
  editor: ReturnType<typeof useCreateBlockNote>,
  editable: boolean,
) {
  const { registerZone, state } = usePointerDrag();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zoneCleanupRef = useRef<(() => void) | null>(null);
  const indicatorElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    indicatorElementRef.current?.removeAttribute("data-misty-note-drop-position");
    indicatorElementRef.current = null;

    if (
      state.payload?.kind !== NOTE_BLOCK_DRAG_KIND ||
      state.activeZoneId !== "note-editor" ||
      !state.pointer ||
      !rootRef.current
    )
      return;
    const target = noteBlockTargetAt(rootRef.current, state.payload.id, state.pointer.y);
    if (!target) return;

    target.element.dataset.mistyNoteDropPosition = target.placement;
    indicatorElementRef.current = target.element;

    return () => {
      target.element.removeAttribute("data-misty-note-drop-position");
    };
  }, [state.activeZoneId, state.payload, state.pointer]);

  const register = useCallback(
    (root: HTMLDivElement | null) => {
      zoneCleanupRef.current?.();
      zoneCleanupRef.current = null;
      rootRef.current = root;
      if (!root || !editable) return;

      const spec = {
        current: {
          id: "note-editor",
          accepts: (payload: PointerDragPayload) => payload.kind === NOTE_BLOCK_DRAG_KIND,
          onDrop: (payload: PointerDragPayload, pointer: { x: number; y: number }) => {
            if (payload.kind !== NOTE_BLOCK_DRAG_KIND) return;
            const target = noteBlockTargetAt(root, payload.id, pointer.y);
            const sourceBlock = findBlockById(editor.document, payload.id);
            if (!target || !sourceBlock) return;
            moveNoteBlock(editor, sourceBlock, target.blockId, target.placement);
          },
        },
      };
      zoneCleanupRef.current = registerZone(root, spec);
    },
    [editable, editor, registerZone],
  );

  useEffect(
    () => () => {
      indicatorElementRef.current?.removeAttribute("data-misty-note-drop-position");
      zoneCleanupRef.current?.();
      zoneCleanupRef.current = null;
      rootRef.current = null;
    },
    [],
  );

  return register;
}

function noteBlockElement(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(`.bn-block-outer[data-id="${CSS.escape(blockId)}"]`);
}

function setNoteBlockDragHighlight(element: HTMLElement | null, active: boolean) {
  element?.classList.toggle("misty-note-block-is-dragging", active);
  element
    ?.querySelectorAll<HTMLElement>(".bn-block-content")
    .forEach((content) => content.classList.toggle("misty-note-block-is-dragging", active));
}

export function noteBlockTargetAt(root: HTMLElement, sourceBlockId: string, pointerY: number) {
  let closest:
    | {
        element: HTMLElement;
        blockId: string;
        placement: "before" | "after";
        distance: number;
      }
    | undefined;

  root.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]").forEach((element) => {
    const blockId = element.dataset.id;
    if (!blockId || blockId === sourceBlockId || !element.isConnected) return;
    const rect = element.getBoundingClientRect();
    const distance =
      pointerY < rect.top
        ? rect.top - pointerY
        : pointerY > rect.bottom
          ? pointerY - rect.bottom
          : 0;
    if (closest && closest.distance <= distance) return;
    closest = {
      element,
      blockId,
      placement: pointerY < rect.top + rect.height / 2 ? "before" : "after",
      distance,
    };
  });

  return closest;
}

function findBlockById(
  blocks: Block<any, any, any>[],
  blockId: string,
): Block<any, any, any> | null {
  for (const block of blocks) {
    if (block.id === blockId) return block;
    const child = findBlockById(block.children, blockId);
    if (child) return child;
  }
  return null;
}

function moveNoteBlock(
  editor: ReturnType<typeof useCreateBlockNote>,
  sourceBlock: Block<any, any, any>,
  targetBlockId: string,
  placement: "before" | "after",
) {
  editor.transact(() => {
    editor.removeBlocks([sourceBlock.id]);
    editor.insertBlocks([sourceBlock], targetBlockId, placement);
  });
}

function blockPreviewText(block: Block<any, any, any>): ReactNode {
  const content = Array.isArray(block.content)
    ? block.content
        .map((item) => ("text" in item ? item.text : ""))
        .join("")
        .trim()
    : "";
  return content || block.type;
}

function collaborationUser(accountId?: string) {
  const id = accountId?.trim() || "misty-user";
  return {
    name: id,
    color: colorForId(id),
  };
}

function colorForId(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  const colors = ["#fb7185", "#38bdf8", "#34d399", "#f59e0b", "#a78bfa", "#f472b6"];
  return colors[hash % colors.length];
}

export default NoteBlockEditor;
