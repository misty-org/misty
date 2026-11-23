import { Text } from "@misty/ui";
import type { SpaceChatStarter } from "./ChatMessages";

export function ChatStarters({ onStarter }: { onStarter?: (starter: SpaceChatStarter) => void }) {
  return (
    <Text
      bare
      as="div"
      size="control"
      tone="muted"
      className="flex min-h-48 flex-col items-center justify-center gap-2 text-center"
    >
      {onStarter ? (
        <>
          <Text bare as="h2" tone="default" className="m-0 font-medium">
            Start the conversation
          </Text>
          <p className="m-0">Send a message below to get things started.</p>
        </>
      ) : (
        <p className="m-0">You can read this conversation, but you cannot send messages.</p>
      )}
    </Text>
  );
}
