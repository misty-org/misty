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
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  NavRow,
  NavRowLabel,
  OverflowFadeText,
  Text,
  Tooltip,
  type TextTone,
} from "@/shared/ui";
import type { SidebarChat } from "./SidebarChats";
import { markSlotClass } from "./styles";
import { useNow } from "@/shared/hooks/useNow";

/** The pieces of the sidebar's chat list: a chat's row, the row while it is renamed, a section's
 * name dialog, and the menu keys. */

const statusWords: Record<ChatStatus, string> = {
  working: "Working",
  "needs-you": "Needs you",
  failed: "Failed",
  done: "",
};

const statusTones: Record<ChatStatus, TextTone | undefined> = {
  working: "working",
  "needs-you": "waiting",
  failed: "failed",
  done: undefined,
};

/** A chat's row: its agent's mark, its title with its agent's name beside it (so two chats with
 * the same title, from different agents, read apart), and what its agent is doing or when it was
 * last touched. A selected row is washed like the open one; an unread one has a brighter title. */
export function ChatRow(props: {
  chat: SidebarChat;
  mark: ReactNode;
  agentName?: string;
  status?: ChatStatus;
  current: boolean;
  selected: boolean;
  unread: boolean;
  onPress(event: MouseEvent): void;
}) {
  const now = useNow();
  const word = props.status ? statusWords[props.status] : "";
  return (
    <NavRow
      hover="fill"
      current={props.current}
      selected={props.selected}
      data-selected={props.selected || undefined}
      data-unread={props.unread || undefined}
      data-status={props.status}
      onClick={props.onPress}
    >
      <span className={markSlotClass}>{props.mark}</span>
      {/* The title gives way first; the agent's name keeps up to 40% of the row. */}
      <NavRowLabel
        bright={props.current || props.selected || props.unread}
        className={cn(props.agentName ? "flex-initial" : "flex-1", props.unread && "font-medium")}
      >
        {props.chat.title || "New conversation"}
      </NavRowLabel>
      {props.agentName ? (
        // The chat's agent, after its title and dimmer than it, so two chats with one title from
        // different agents read apart.
        <OverflowFadeText className="mr-auto max-w-[40%] flex-none text-control opacity-60">
          <span className="sr-only">, </span>
          {props.agentName}
        </OverflowFadeText>
      ) : null}
      {props.status && word ? (
        // The one place the sidebar uses color: what a chat's agent is doing, as a dot alone. The
        // word stays for screen readers and the tooltip.
        <Tooltip content={word}>
          <Text
            bare
            tone={statusTones[props.status]}
            role="img"
            aria-label={word}
            className="inline-flex flex-none items-center px-1 text-micro tabular-nums"
          >
            <span
              className={cn(
                "size-2 rounded-full bg-current",
                props.status === "working" &&
                  "animate-[misty-breathe_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
              )}
            />
          </Text>
        </Tooltip>
      ) : (
        // An unread chat: a small neutral dot before its time.
        <span className="inline-flex flex-none items-center gap-1 text-micro tabular-nums">
          {props.unread ? (
            <Text
              bare
              tone="chrome"
              className="size-1.5 rounded-full bg-current"
              aria-label="Unread"
            />
          ) : null}
          {shortAgo(props.chat.updatedAt, now)}
        </span>
      )}
    </NavRow>
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
    // Renaming in place: the title becomes a field the same size, on the open chat's wash.
    <NavRow still selected data-renaming="true">
      <span className={markSlotClass}>{props.mark}</span>
      <Text bare tone="chrome" className="contents">
        <Input
          ref={field}
          variant="bare"
          className="flex-1 text-inherit"
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
      </Text>
    </NavRow>
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
            <Button variant="secondary" size="lg" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={!name.trim()}>
              {props.renaming ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
