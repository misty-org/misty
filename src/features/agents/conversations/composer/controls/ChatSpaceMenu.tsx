import { House, Layers } from "lucide-react";
import { useEffect } from "react";
import {
  preferredDefaultSpace,
  spaceForNewItems,
  spacesSnapshot,
  useSpaceWindowStore,
  useSpacesDirectory,
} from "@/features/app-windows";
import { MenuLabel, MenuRadioGroup, MenuRadioItem, type PathLineSegment } from "@/shared/ui";
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
 * The Space part of the composer's path line: the one Space this chat works in, as an engine's
 * chat works in one project, with the others to move it to. Every agent can work in every Space;
 * each chat picks one at a time. While a reply runs the chat stays where it is.
 */
export function useSpaceSegment(
  conversationId: string | undefined,
  locked: boolean,
): PathLineSegment | null {
  const spaces = useSpacesDirectory((state) => state.spaces);
  const current = useChatSpace(conversationId);
  useEffect(() => {
    if (!spacesSnapshot().spaces.length) void spacesSnapshot().load();
  }, []);
  if (!spaces.length) return null;
  const personal = preferredDefaultSpace(spaces);
  const shown = spaces.find((space) => space.id === current);
  return {
    id: "space",
    icon: shown && shown.id === personal?.id ? House : Layers,
    label: shown?.name ?? "No Space",
    menu: (
      <>
        <MenuLabel>Space</MenuLabel>
        <MenuRadioGroup
          value={current}
          onValueChange={(next) => moveChatToSpace(conversationId, next)}
        >
          {spaces.map((space) => (
            <MenuRadioItem
              key={space.id}
              icon={space.id === personal?.id ? House : Layers}
              value={space.id}
              label={space.name}
              disabled={locked && space.id !== current}
              reason={locked ? "Wait for the reply to finish" : undefined}
            />
          ))}
        </MenuRadioGroup>
      </>
    ),
  };
}
