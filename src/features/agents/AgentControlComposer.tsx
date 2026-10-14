import { ListPlus } from "lucide-react";
import { IconButton, MessageComposer, MessageComposerSend } from "@/shared/ui";

/** The island's message box: Send steers the task, the list button queues a new one. */
export function AgentControlComposer({
  name,
  message,
  setMessage,
  pending,
  send,
}: {
  name: string;
  message: string;
  setMessage: (value: string) => void;
  pending: boolean;
  send: (text: string, queue: boolean) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send(message, false);
      }}
    >
      <MessageComposer
        className="w-full"
        inputProps={{
          id: "agent-island-message",
          "aria-label": `Message ${name}`,
          value: message,
          onChange: (event) => setMessage(event.target.value),
          placeholder: `Tell ${name} what to change, or ask for something new`,
          disabled: pending,
          onKeyDown: (event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          },
        }}
        actions={
          <>
            <IconButton
              label="New task"
              size="sm"
              disabled={pending || !message.trim()}
              onClick={() => send(message, true)}
            >
              <ListPlus aria-hidden="true" />
            </IconButton>
            <MessageComposerSend
              type="submit"
              label="Send"
              busy={pending}
              disabled={!message.trim()}
            />
          </>
        }
      />
    </form>
  );
}
