import { Text } from "@/shared/ui";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import type { ItemVisibility } from "../../../api/visibility";
import { LiveEmbed } from "../../../embeds/LiveEmbed";
import { embedFromAttributes, NoteEmbed, type NoteEmbedAttributes } from "./noteEmbedNode";

interface NoteEmbedOptions {
  spaceId?: string;
  hostVisibility: ItemVisibility;
}

/** The embed node as the editor shows it: the live chart, range or frame, read-only. */
function NoteEmbedNodeView(props: ReactNodeViewProps) {
  const options = props.extension.options as NoteEmbedOptions;
  const attrs = props.node.attrs as Partial<NoteEmbedAttributes>;
  const embed = embedFromAttributes(attrs);
  const editable = props.editor.isEditable;
  const updateAttributes = props.updateAttributes;
  return (
    <NodeViewWrapper
      className="misty-tiptap-embed"
      data-misty-embed=""
      data-selected={props.selected || undefined}
      contentEditable={false}
    >
      {embed && options.spaceId ? (
        <LiveEmbed
          spaceId={options.spaceId}
          embed={embed}
          hostVisibility={options.hostVisibility}
          onSourceTitle={(title) => {
            // The last-known title, kept for when the source can no longer be read.
            if (editable && title !== attrs.title) updateAttributes({ title });
          }}
        />
      ) : (
        <Text size="control" tone="muted">
          {attrs.title || "This embed can’t be shown"}
        </Text>
      )}
    </NodeViewWrapper>
  );
}

/** The editor's embed node: the schema's node with the live view, for one doc in one Space. */
export function noteEmbedEditorNode(options: {
  spaceId?: string;
  hostVisibility?: ItemVisibility;
}) {
  return NoteEmbed.extend<NoteEmbedOptions>({
    addOptions() {
      return {
        spaceId: options.spaceId,
        hostVisibility: options.hostVisibility ?? "public",
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(NoteEmbedNodeView);
    },
  });
}
