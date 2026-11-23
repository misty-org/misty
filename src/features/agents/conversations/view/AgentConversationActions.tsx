import { useConversationActions } from "./UseConversationActions";

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
