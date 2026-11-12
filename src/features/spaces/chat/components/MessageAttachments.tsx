import { copyLibraryItemsToClipboard } from "../../library";
import { spacesApi } from "../../api/api";
import type { SpaceLibraryItem, SpaceMessage, SpaceNode } from "../../api/dto/entities";
import { Badge, Button, Tooltip } from "@/shared/ui";
import { LibraryBig, Paperclip } from "lucide-react";

interface MessageAttachmentsProps {
  message: SpaceMessage;
  nodes: SpaceNode[];
  libraryItems: SpaceLibraryItem[];
  spaceId: string;
  onOpenNode: (nodeId: string) => void;
  onError: (message: string) => void;
  onLibraryItem: (item: SpaceLibraryItem) => void;
  onReload: () => void;
}

/** Drive links, Library picks and uploads carried by a message. */
export function MessageAttachments(props: MessageAttachmentsProps) {
  const { message } = props;

  return (
    <>
      {message.file_node_ids.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.file_node_ids.map((nodeId) => (
            <Button
              variant="secondary"
              className="h-7 text-xs"
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

      {(message.library_item_ids?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.library_item_ids?.map((itemId) => {
            const item = props.libraryItems.find((candidate) => candidate.id === itemId);
            return (
              <Tooltip key={itemId} content="Copy to clipboard">
                <Button
                  variant="secondary"
                  className="h-7 text-xs"
                  type="button"
                  disabled={!item}
                  icon={LibraryBig}
                  onClick={() => {
                    if (!item) return;
                    void copyLibraryItemsToClipboard(props.spaceId, [item]).catch((error) =>
                      props.onError(
                        error instanceof Error
                          ? error.message
                          : "The Library item could not be copied.",
                      ),
                    );
                  }}
                >
                  {item?.display_name ?? "Unavailable Library item"}
                </Button>
              </Tooltip>
            );
          })}
        </div>
      ) : null}

      {(message.attachments?.length ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {message.attachments?.map((attachment) => (
            <div
              className="inline-flex items-center gap-1 rounded-md bg-charcoal-card p-1 pl-2 text-xs"
              key={attachment.id}
            >
              <Paperclip className="size-3" />
              <Button
                variant="quiet"
                className="h-auto px-1 py-0 text-xs"
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
              {attachment.promoted_item_id ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-3xs">
                  In Library
                </Badge>
              ) : (
                <Button
                  variant="quiet"
                  size="sm"
                  className="px-1.5 text-3xs"
                  type="button"
                  onClick={() =>
                    void spacesApi.promoteAttachment(props.spaceId, attachment.id).then((item) => {
                      props.onLibraryItem(item);
                      props.onReload();
                    })
                  }
                >
                  Add to Library
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
