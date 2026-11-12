import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { shortAgo, type ChatSection, type ChatStatus } from "@/features/agents";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  Pressable,
} from "@/shared/ui";
import type { SidebarChat } from "./SidebarChats";

/** The pieces of the sidebar's chat list: a chat's row, the row while it is renamed, a section's
 * name dialog, and the menu keys. */

const statusWords: Record<ChatStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  failed: "Failed",
  done: "",
};

/** A chat's row: its agent's mark, its title, and what its agent is doing or when it was last
 * touched. A selected row is washed like the open one; an unread one has a brighter title. */
export function ChatRow(props: {
  chat: SidebarChat;
  mark: ReactNode;
  status?: ChatStatus;
  current: boolean;
  selected: boolean;
  unread: boolean;
  onPress(event: MouseEvent): void;
}) {
  const word = props.status ? statusWords[props.status] : "";
  return (
    <Pressable
      type="button"
      className="misty-space-chat-row"
      aria-current={props.current ? "page" : undefined}
      data-selected={props.selected || undefined}
      data-unread={props.unread || undefined}
      data-status={props.status}
      onClick={props.onPress}
    >
      <span className="misty-space-nav-icon">{props.mark}</span>
      <span className="misty-space-chat-title">{props.chat.title || "New conversation"}</span>
      {word ? (
        // The color says the state; the word stays for screen readers and the tooltip.
        <span className="misty-space-chat-status" role="img" aria-label={word} title={word}>
          <span className="misty-space-chat-dot" />
        </span>
      ) : (
        <span className="misty-space-chat-meta">
          {props.unread ? <span className="misty-space-chat-unread" aria-label="Unread" /> : null}
          {shortAgo(props.chat.updatedAt)}
        </span>
      )}
    </Pressable>
  );
}

/** The row while its chat is being renamed: Enter or leaving the field saves, Escape cancels. */
export function RenameRow(props: {
  chat: SidebarChat;
  mark: ReactNode;
  onDone(title?: string): void;
}) {
  const [title, setTitle] = useState(props.chat.title);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const finish = (next?: string) => {
    if (finished.current) return;
    finished.current = true;
    props.onDone(next);
  };
  useEffect(() => {
    // After the menu that asked for it has closed and given focus back.
    const frame = requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="misty-space-chat-row" data-renaming="true">
      <span className="misty-space-nav-icon">{props.mark}</span>
      <Input
        ref={field}
        variant="bare"
        className="misty-space-chat-rename"
        aria-label="Chat name"
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => finish(title)}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(title);
          else if (event.key === "Escape") finish();
        }}
      />
    </div>
  );
}

/** Runs the menu item whose key was pressed, as the menu shows beside each item. */
export function pressMenuKey(event: KeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
  const item = event.currentTarget.querySelector<HTMLElement>(
    `[data-menu-key="${event.key.toLowerCase()}"]:not([data-disabled])`,
  );
  if (!item) return;
  event.preventDefault();
  item.click();
}

/** Names a new section, or renames one. */
export function SectionNameDialog(props: {
  open: boolean;
  renaming?: ChatSection;
  onClose(): void;
  onSave(name: string): void;
}) {
  const [name, setName] = useState(props.renaming?.name ?? "");
  useEffect(() => {
    if (props.open) setName(props.renaming?.name ?? "");
  }, [props.open, props.renaming]);
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{props.renaming ? "Rename section" : "New section"}</DialogTitle>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave(name);
          }}
        >
          <Input
            aria-label="Section name"
            value={name}
            maxLength={80}
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {props.renaming ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
