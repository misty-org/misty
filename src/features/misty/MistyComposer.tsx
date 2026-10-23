import { CommandUsageEstimate } from "./CommandUsageEstimate";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  FileInput,
  IconButton,
  MenuItem,
  Spinner,
  MessageComposer,
  MessageComposerSend,
} from "@/shared/ui";
import { Camera, ImagePlus, Plus, X } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { validateMistyImage } from "./mistyImageValues";
import type { MistyImageAttachment } from "./types";

export function MistyComposer(props: {
  value: string;
  modelId?: string;
  onChange: (value: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  attachments: MistyImageAttachment[];
  maxAttachments: number;
  onAddFiles: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (attachment: MistyImageAttachment) => void | Promise<void>;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCapture?: () => void;
  voiceControl?: ReactNode;
  /** Controls after Attach in the leading group, such as a conversation's mode. */
  leadingControl?: ReactNode;
  modelControl?: ReactNode;
  trailingControl?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  compact?: boolean;
  /** "inline": the box is one row (attach, text, voice, send); Stop replaces Send while a reply runs. */
  layout?: "default" | "conversation" | "inline";
  /** The surface shows usage itself (the Agents control bar), so the footer omits it. */
  hideUsageEstimate?: boolean;
  className?: string;
  onError?: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = props.textareaRef ?? localTextareaRef;
  const [dragging, setDragging] = useState(false);
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
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  };
  const canSend = Boolean(
    props.value.trim() || props.attachments.some((item) => item.state === "ready"),
  );
  const showEstimate = !props.busy && !props.hideUsageEstimate;
  // An empty footer would still add its bottom padding under the input row.
  const hasFooter = Boolean(props.modelControl || showEstimate);
  const send = (
    <MessageComposerSend
      label="Send to Misty"
      disabled={
        props.disabled || !canSend || props.attachments.some((item) => item.state !== "ready")
      }
      busy={props.busy}
      onClick={props.onSubmit}
    />
  );
  // In a conversation the one button turns into Stop while a reply runs, rather than
  // a second button appearing beside Send.
  const sendControl =
    (props.layout === "conversation" || props.layout === "inline") && props.trailingControl ? (
      props.trailingControl
    ) : (
      <>
        {send}
        {props.trailingControl}
      </>
    );
  return (
    <MessageComposer
      className={cn(dragging && "border-cream-muted bg-charcoal-hover", props.className)}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!props.disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) accept(files);
      }}
      data-misty-universal-composer
      data-composer-layout={props.layout ?? "default"}
      data-dragging={dragging}
      data-misty-composer={props.compact ? "follow-up" : "launcher"}
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
            if (
              !props.disabled &&
              !props.busy &&
              canSend &&
              props.attachments.every((item) => item.state === "ready")
            )
              props.onSubmit();
          }
        },
        disabled: props.disabled,
        "aria-label": "Message Misty",
        placeholder: props.placeholder ?? "Ask anything…",
      }}
      context={
        props.attachments.length ? (
          <div className="flex gap-2 overflow-x-auto px-3 pt-3">
            {props.attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/20"
              >
                {attachment.mimeType.startsWith("image/") ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <span
                    className="grid size-full place-items-center break-all p-1 text-xs"
                    title={attachment.name}
                  >
                    {attachment.name}
                  </span>
                )}
                {attachment.state !== "ready" ? (
                  <div className="absolute inset-0 grid place-items-center bg-black/60">
                    {attachment.state === "failed" ? (
                      <span className="text-[9px] text-cream">Failed</span>
                    ) : (
                      <Spinner label={false} className="text-white" />
                    )}
                  </div>
                ) : null}
                <IconButton
                  variant="overlay"
                  shape="round"
                  size="2xs"
                  label={`Remove ${attachment.name}`}
                  tooltip={false}
                  className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => void props.onRemoveAttachment(attachment)}
                >
                  <X className="size-3" />
                </IconButton>
                {attachment.state === "uploading" ? (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
                    <span
                      className="block h-full bg-cream"
                      style={{ width: `${Math.round((attachment.progress ?? 0) * 100)}%` }}
                    />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null
      }
      leading={
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
          {props.onCapture ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Add attachments" tooltip={false} disabled={props.disabled}>
                  <Plus className="size-4" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" data-misty-layer-portal>
                <MenuItem
                  icon={<ImagePlus className="size-4" />}
                  label="Attach files"
                  onSelect={() => fileRef.current?.click()}
                />
                <MenuItem
                  icon={<Camera className="size-4" />}
                  label="Capture part of the screen"
                  onSelect={props.onCapture}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <IconButton
              label="Attach files"
              disabled={props.disabled}
              onClick={() => fileRef.current?.click()}
            >
              <Plus className="size-4" />
            </IconButton>
          )}
          {props.leadingControl}
        </>
      }
      footer={
        hasFooter && (
          <div className="flex min-w-0 flex-col gap-2">
            {props.modelControl}
            {showEstimate && <CommandUsageEstimate text={props.value} model={props.modelId} />}
          </div>
        )
      }
      // A conversation keeps send (or Stop) inside the text box; the rest of its toolbar
      // sits beneath the box.
      overlay={
        props.layout === "conversation" && <div className="misty-composer-send">{sendControl}</div>
      }
      actions={
        <>
          {props.voiceControl}
          {props.layout !== "conversation" && sendControl}
        </>
      }
    />
  );
}
