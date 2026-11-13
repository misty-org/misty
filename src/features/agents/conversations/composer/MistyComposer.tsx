import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  FileInput,
  IconButton,
  MenuItem,
  MenuTrigger,
  MessageComposer,
  MessageComposerSend,
  Progress,
  Spinner,
  Text,
  Tooltip,
  type ActionBarItem,
} from "@/shared/ui";
import { ImagePlus, Plus, ScanLine, X } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useRef } from "react";
import { useFileDropZone } from "@/shared/hooks/useFileDropZone";
import { validateMistyImage } from "./mistyImageValues";
import type { MistyImageAttachment } from "../state/conversationTypes";

/**
 * The chat's message box: the text, then one bar under it that never wraps. The + menu leads the
 * bar (attach files, capture part of the screen, and whatever the chat adds), then the chat's own
 * controls as ActionBar items, which give way by priority; the end holds what never folds and the
 * send button (or what replaces it, such as Stop). Where the chat works is in the context panel.
 */
export function MistyComposer(props: {
  value: string;
  onChange: (value: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  attachments: MistyImageAttachment[];
  maxAttachments: number;
  onAddFiles: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (attachment: MistyImageAttachment) => void | Promise<void>;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Captures part of the screen; it is offered in the + menu. */
  onCapture?: () => void;
  /** More rows for the + menu, after attach and capture. */
  addMenuItems?: ReactNode;
  /** The bar's controls after the + menu, which give way by their priorities. */
  items?: ActionBarItem[];
  /** Controls at the bar's end before the send button; they never fold. */
  end?: ReactNode;
  /** Replaces the send button, such as Stop while a reply runs. */
  sendControl?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  /** A menu anchored above the text, such as the `@`, `/` and `$` suggestions. */
  popup?: ReactNode;
  /** Attachments that aren't files, shown before the files (Misty's browser). */
  attachedChips?: ReactNode;
  /** A taller box in body type, for a chat with nothing in it yet. */
  roomy?: boolean;
  /** Rows about the chat's state at the top of the box, such as queued messages. */
  status?: ReactNode;
  className?: string;
  onError?: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = props.textareaRef ?? localTextareaRef;
  const accept = (files: File[]) => {
    if (props.disabled) return;
    try {
      const room = props.maxAttachments - props.attachments.length;
      if (room <= 0)
        throw new Error(
          `Misty accepts up to ${props.maxAttachments} image${props.maxAttachments === 1 ? "" : "s"} here.`,
        );
      const selected = files.slice(0, room);
      selected.forEach(validateMistyImage);
      if (selected.length < files.length)
        props.onError?.(`Only the first ${room} image${room === 1 ? "" : "s"} were added.`);
      void props.onAddFiles(selected);
    } catch (error) {
      props.onError?.(
        error instanceof Error ? error.message : "Misty could not attach that image.",
      );
    }
  };
  // Files dropped from the computer's file manager, on every desktop system and in a browser,
  // anywhere on the content area around the composer that is marked to take them.
  const dropZone = useFileDropZone<HTMLDivElement>(accept, {
    disabled: props.disabled,
    onError: props.onError,
    area: true,
  });
  const ready = props.attachments.every((item) => item.state === "ready");
  const canSend = Boolean(
    props.value.trim() || props.attachments.some((item) => item.state === "ready"),
  );
  const addRows = (
    <>
      <MenuItem icon={ImagePlus} label="Attach files" onSelect={() => fileRef.current?.click()} />
      {props.onCapture ? (
        <MenuItem icon={ScanLine} label="Capture part of the screen" onSelect={props.onCapture} />
      ) : null}
      {props.addMenuItems}
    </>
  );
  const add: ActionBarItem = {
    id: "add",
    icon: Plus,
    label: "Add",
    // The + menu is the last thing to fold: it is how files and captures get in.
    priority: 100,
    disabled: props.disabled,
    menu: addRows,
    render: () => (
      <DropdownMenu>
        <MenuTrigger
          label="Add"
          iconOnly
          icon={Plus}
          disabled={props.disabled}
          data-tour="composer-add"
        />
        <DropdownMenuContent align="start" side="top" data-misty-layer-portal>
          {addRows}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  };
  return (
    <>
      <FileInput
        ref={fileRef}
        accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md,.csv,.json"
        multiple={props.maxAttachments > 1}
        onChange={(event) => {
          accept(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <MessageComposer
        ref={dropZone.ref}
        variant="card"
        roomy={props.roomy}
        status={props.status}
        dragging={dropZone.dragging}
        className={props.className}
        {...dropZone.handlers}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length) accept(files);
        }}
        data-misty-universal-composer
        data-tour="composer"
        inputRef={textareaRef}
        inputProps={{
          "data-global-misty-launcher-input": true,
          value: props.value,
          onChange: (event) => props.onChange(event.target.value),
          onKeyDown: (event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            props.onKeyDown?.(event);
            if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!props.disabled && !props.busy && canSend && ready) props.onSubmit();
            }
          },
          disabled: props.disabled,
          "aria-label": "Message",
          placeholder: props.placeholder ?? "Ask anything…",
        }}
        context={
          props.attachments.length || props.attachedChips ? (
            <>
              {props.attachedChips}
              {props.attachments.map((attachment) => (
                <AttachmentTile
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => void props.onRemoveAttachment(attachment)}
                />
              ))}
            </>
          ) : null
        }
        overlay={props.popup}
        items={[add, ...(props.items ?? [])]}
        end={
          <>
            {props.end}
            {props.sendControl ?? (
              <MessageComposerSend
                label="Send message"
                disabled={props.disabled || !canSend || !ready}
                busy={props.busy}
                onClick={props.onSubmit}
              />
            )}
          </>
        }
      />
    </>
  );
}

/** One attached file above the text: its picture or name, its upload, and a remove button. */
function AttachmentTile({
  attachment,
  onRemove,
}: {
  attachment: MistyImageAttachment;
  onRemove(): void;
}) {
  return (
    <div
      className={cn(
        "group relative size-16 shrink-0 overflow-hidden rounded-xl",
        "border bg-black/20",
      )}
    >
      {attachment.mimeType.startsWith("image/") ? (
        <img src={attachment.previewUrl} alt={attachment.name} className="size-full object-cover" />
      ) : (
        <Tooltip content={attachment.name}>
          <span className="grid size-full place-items-center break-all p-1 text-xs">
            {attachment.name}
          </span>
        </Tooltip>
      )}
      {attachment.state !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center bg-black/60">
          {attachment.state === "failed" ? (
            <Text bare tone="default" className="text-3xs">
              Failed
            </Text>
          ) : (
            <Spinner label={false} className="text-white" />
          )}
        </div>
      ) : null}
      <IconButton
        variant="overlay"
        size="sm"
        label={`Remove ${attachment.name}`}
        className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
      >
        <X />
      </IconButton>
      {attachment.state === "uploading" ? (
        <Progress
          variant="media"
          aria-label="Uploading"
          value={Math.round((attachment.progress ?? 0) * 100)}
          className="absolute inset-x-0 bottom-0"
        />
      ) : null}
    </div>
  );
}
