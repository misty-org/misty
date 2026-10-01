import type { SpaceChatStarter } from "./ChatMessages";

/** The opening screen of an empty conversation. */
export function SpaceChatStarters({
  onStarter,
}: {
  spaceName?: string;
  onStarter?: (starter: SpaceChatStarter) => void;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-cream-muted">
      {onStarter ? (
        <>
          <h2 className="m-0 font-medium text-cream">Start the conversation</h2>
          <p className="m-0">Send a message below to get things started.</p>
        </>
      ) : (
        <p className="m-0">You can read this conversation, but you cannot send messages.</p>
      )}
    </div>
  );
}
