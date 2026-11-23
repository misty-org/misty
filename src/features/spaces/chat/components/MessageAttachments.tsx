import { spacesApi } from "../../api/api";
import type { SpaceMessage, SpaceNode } from "../../api/dto/entities";
import { Button, Surface } from "@misty/ui";
import { Paperclip } from "lucide-react";

interface MessageAttachmentsProps {
  message: SpaceMessage;
  nodes: SpaceNode[];
  spaceId: string;
  onOpenNode: (nodeId: string) => void;
}

export function MessageAttachments(props: MessageAttachmentsProps) {
  const { message } = props;

  return (
    <>
      {message.file_node_ids.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.file_node_ids.map((nodeId) => (
            <Button
              variant="secondary"
              size="sm"
              type="button"
              key={nodeId}
              icon={Paperclip}
              onClick={() => props.onOpenNode(nodeId)}
            >
              {props.nodes.find((item) => item.id === nodeId)?.display_name ?? "Drive file"}
            </Button>
          ))}
        </div>
      ) : null}

      {(message.attachments?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.attachments?.map((attachment) => (
            <Surface
              tone="card"
              radius="md"
              className="inline-flex items-center gap-1 p-1 pl-2"
              key={attachment.id}
            >
              <Paperclip />
              <Button
                variant="quiet"
                size="sm"
                type="button"
                onClick={() =>
                  void spacesApi.downloadAttachment(
                    props.spaceId,
                    attachment.id,
                    attachment.display_name,
                  )
                }
              >
                {attachment.display_name}
              </Button>
            </Surface>
          ))}
        </div>
      ) : null}
    </>
  );
}
