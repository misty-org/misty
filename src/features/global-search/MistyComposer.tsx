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
import { Camera, ImagePlus, Plus, Search, X } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { SearchAskToggle } from "./GlobalMistySupport";
import { validateMistyImage } from "./mistyImageValues";
import type { GlobalAiMode, MistyImageAttachment } from "./types";

export function MistyComposer(props: {
  value: string;
  modelId?: string;
  onChange: (value: string) => void;
  mode: GlobalAiMode;
  onModeChange?: (mode: GlobalAiMode) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  attachments: MistyImageAttachment[];
  maxAttachments: number;
  onAddFiles: (files: File[]) => void | Promise<void>;
  onRemoveAttachment: (attachment: MistyImageAttachment) => void | Promise<void>;
  onSubmit: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCapture?: () => void;
  voiceControl?: ReactNode;
  modelControl?: ReactNode;
  trailingControl?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  placeholder?: string;
  compact?: boolean;
  layout?: "default" | "conversation";
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
        "aria-label": props.mode === "search" ? "Search Misty" : "Message Misty",
        placeholder:
          props.placeholder ??
          (props.mode === "search"
            ? "Search files, notes, and connected apps…"
            : "Ask Misty anything…"),
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
            accept={
              props.mode === "search"
                ? "image/jpeg,image/png,image/webp"
                : "image/jpeg,image/png,image/webp,.pdf,.docx,.txt,.md,.csv,.json"
            }
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
        </>
      }
      footer={
        <div className="flex min-w-0 flex-col gap-2">
          {props.onModeChange ? (
            <SearchAskToggle mode={props.mode} compact onChange={props.onModeChange} />
          ) : props.mode === "search" ? (
            <span className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-cream-muted">
              <Search className="size-3.5" />
              Search
            </span>
          ) : (
            props.modelControl
          )}
          {props.mode !== "search" && !props.busy && !props.hideUsageEstimate && (
            <CommandUsageEstimate text={props.value} model={props.modelId} />
          )}
        </div>
      }
      actions={
        <>
          {props.voiceControl}
          {!(props.layout === "conversation" && props.busy && props.trailingControl) && (
            <MessageComposerSend
              label={props.mode === "search" ? "Search" : "Send to Misty"}
              disabled={
                props.disabled ||
                !canSend ||
                props.attachments.some((item) => item.state !== "ready")
              }
              busy={props.busy}
              onClick={props.onSubmit}
            />
          )}
          {props.trailingControl}
        </>
      }
    />
  );
}
