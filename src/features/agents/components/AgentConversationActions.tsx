import { useConversationActions } from "./useConversationActions";

/** Shared by collection rows, history, recents, and the open conversation. */
export function AgentConversationActions(props: {
  conversation: { id: string; title?: string };
  disabled?: boolean;
  onOpen?(): void;
}) {
  const { dropdown, dialogs } = useConversationActions(props);
  return (
    <>
      {dropdown}
      {dialogs}
    </>
  );
}
