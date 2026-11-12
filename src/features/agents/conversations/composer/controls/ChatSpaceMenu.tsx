import { House } from "lucide-react";
import { useEffect } from "react";
import {
  preferredDefaultSpace,
  spaceForNewItems,
  spacesSnapshot,
  useSpaceWindowStore,
  useSpacesDirectory,
} from "@/features/app-windows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  MenuTrigger,
} from "@/shared/ui";
import { chatSpaceId } from "../../state/conversationSpace";
import { useMistyStore } from "../../state/useMistyStore";

/** The Space a chat works in, or a new chat would: its own, the one picked for it, or the window's. */
export function useChatSpace(conversationId?: string): string {
  const chat = useMistyStore((state) =>
    conversationId ? state.conversations.find((item) => item.id === conversationId) : undefined,
  );
  const draft = useMistyStore((state) => state.draftSpaceId);
  const personalId = useSpaceWindowStore((state) => state.personalSpaceId);
  const here = useSpaceWindowStore((state) => state.identity);
  if (chat) return chatSpaceId(chat, personalId);
  return draft || (here.personal ? (personalId ?? "") : (here.spaceId ?? ""));
}

/**
 * Moves a chat to another Space, or picks the Space a new chat will be made in. Its next run works
 * there, and only there; the chat saves like any other change.
 */
export function moveChatToSpace(conversationId: string | undefined, spaceId: string) {
  const personal = spaceId === useSpaceWindowStore.getState().personalSpaceId;
  const store = useMistyStore.getState();
  if (!conversationId || !store.conversations.some((item) => item.id === conversationId)) {
    useMistyStore.setState({
      draftSpaceId: spaceId === spaceForNewItems().spaceId ? undefined : spaceId,
    });
    return;
  }
  useMistyStore.setState({
    conversations: store.conversations.map((item) =>
      item.id === conversationId
        ? { ...item, spaceId, personalSpace: personal || undefined }
        : item,
    ),
  });
}

/**
 * The composer's Space chip: the one Space this chat works in, as an engine's chat works in one
 * project. Every agent can work in every Space; each chat picks one at a time.
 */
export function ChatSpaceMenu(props: { conversationId?: string; disabled?: boolean }) {
  const spaces = useSpacesDirectory((state) => state.spaces);
  const current = useChatSpace(props.conversationId);
  useEffect(() => {
    if (!spacesSnapshot().spaces.length) void spacesSnapshot().load();
  }, []);
  const shown = spaces.find((space) => space.id === current);
  const personal = preferredDefaultSpace(spaces);
  if (!spaces.length) return null;
  const name = shown?.name ?? "No Space";
  return (
    <DropdownMenu>
      <MenuTrigger
        label="Space"
        icon={<House aria-hidden className="size-4 shrink-0" />}
        value={name}
        title={`Space: ${name}`}
        chevron={false}
        disabled={props.disabled}
        className="agent-strip-chip max-w-44"
      />
      <DropdownMenuContent align="start" className="w-64" data-misty-layer-portal>
        <DropdownMenuLabel>Space</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(next) => moveChatToSpace(props.conversationId, next)}
        >
          {spaces.map((space) => (
            <DropdownMenuRadioItem key={space.id} value={space.id}>
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              {space.id === personal?.id ? (
                <span className="text-xs text-cream-muted">Personal</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
