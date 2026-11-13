import { Text } from "@/shared/ui";
import type { SpaceChatStarter } from "./ChatMessages";

/** The opening screen of an empty conversation. */
export function ChatStarters({ onStarter }: { onStarter?: (starter: SpaceChatStarter) => void }) {
  return (
    <Text
      bare
      as="div"
      tone="muted"
      className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm"
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
