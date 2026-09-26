import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { ArrowUp, Camera, ImagePlus, Loader2, Plus, Search, X } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { SearchAskToggle } from "./GlobalMistySupport";
import { validateMistyImage } from "./mistyImageValues";
import type { GlobalAiMode, MistyImageAttachment } from "./types";

export function MistyComposer(props: {
  value: string;
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
  inputFirst?: boolean;
  className?: string;
  onError?: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const accept = (files: File[]) => {
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
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border border-charcoal-border bg-charcoal-card/95 shadow-lg shadow-black/15 transition",
        dragging && "border-blue-400 bg-blue-500/[0.06]",
        props.className,
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
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
      data-misty-composer={props.compact ? "follow-up" : "launcher"}
    >
      {props.attachments.length ? (
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
                    <span className="text-[9px] text-red-300">Failed</span>
                  ) : (
                    <Loader2 className="size-4 animate-spin text-white" />
                  )}
                </div>
              ) : null}
              <Button
                variant="ghost"
                className={cn(
                  "absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/75",
                  "text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100",
                )}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => void props.onRemoveAttachment(attachment)}
              >
                <X className="size-3" />
              </Button>
              {attachment.state === "uploading" ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
                  <span
                    className="block h-full bg-blue-400"
                    style={{ width: `${Math.round((attachment.progress ?? 0) * 100)}%` }}
                  />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        ref={props.textareaRef}
        data-global-misty-launcher-input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
        rows={1}
        aria-label={props.mode === "search" ? "Search Misty" : "Message Misty"}
        placeholder={
          props.placeholder ??
          (props.mode === "search"
            ? "Search files, notes, and connected apps…"
            : "Ask Misty anything…")
        }
        className={cn(
          "max-h-40 min-h-12 w-full resize-none overflow-x-hidden bg-transparent px-4 pb-2.5 pt-3 text-[15px] leading-6 text-cream outline-none placeholder:text-cream-muted",
          props.compact && "min-h-11 px-3.5 pb-2 pt-2.5 text-sm leading-5",
          props.inputFirst && "min-h-20 px-4 pb-3 pt-3 text-base leading-6",
        )}
      />
      <div
        className={cn(
          "flex min-h-10 items-center gap-1 px-3 pb-3",
          !props.inputFirst && "border-t border-charcoal-border pt-1.5",
        )}
      >
        <input
          ref={fileRef}
          hidden
          type="file"
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
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-cream-muted"
                aria-label="Add attachments"
                title="Add attachments"
                disabled={props.disabled}
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" data-misty-layer-portal>
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                <ImagePlus className="size-4" /> Attach files
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={props.onCapture}>
                <Camera className="size-4" /> Capture part of the screen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-cream-muted"
            aria-label="Attach files"
            disabled={props.disabled}
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="size-4" />
          </Button>
        )}
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
        <div className="min-w-0 flex-1" />
        {props.voiceControl}
        <Button
          type="button"
          size="icon"
          className="size-8 shrink-0"
          disabled={
            props.disabled ||
            props.busy ||
            !canSend ||
            props.attachments.some((item) => item.state !== "ready")
          }
          aria-label={props.mode === "search" ? "Search" : "Send to Misty"}
          onClick={props.onSubmit}
        >
          {props.busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </Button>
        {props.trailingControl}
      </div>
    </div>
  );
}
