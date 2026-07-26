import type { SpaceChatStarter } from "@/models/interfaces/features/spaces/components/SpaceChatMessages";
import { AtSign, LibraryBig, MessageSquare, Paperclip } from "lucide-react";

import { Button } from "@/ui";

const starterCardClassName = [
  "h-auto flex-col items-start gap-1 whitespace-normal rounded-xl bg-card px-4 py-3.5",
  "text-left shadow-none inset-ring-1 inset-ring-foreground/10 hover:bg-accent",
].join(" ");

const chatStarters: Array<{
  id: SpaceChatStarter;
  icon: typeof MessageSquare;
  title: string;
  detail: string;
}> = [
  { id: "mention", icon: AtSign, title: "Mention someone", detail: "A teammate in this Space" },
  { id: "files", icon: Paperclip, title: "Attach files", detail: "From this device or a remote" },
  {
    id: "library",
    icon: LibraryBig,
    title: "Share from Library",
    detail: "Items already in this Space",
  },
];

/** The opening screen: one question, then the moves worth making first. */
export function SpaceChatStarters({
  spaceName,
  onStarter,
}: {
  spaceName?: string;
  onStarter?: (starter: SpaceChatStarter) => void;
}) {
  return (
    <div className="grid h-full place-items-center py-10">
      <div className="w-full max-w-2xl text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-muted/60 text-muted-foreground">
          <MessageSquare className="size-5" />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          {spaceName ? `What should we work on in ${spaceName}?` : "Start the conversation"}
        </h2>
        {onStarter ? (
          <div className="mt-7 grid grid-cols-2 gap-2.5 text-left max-sm:grid-cols-1">
            {chatStarters.map((starter) => (
              <Button
                className={starterCardClassName}
                variant="ghost"
                type="button"
                key={starter.id}
                onClick={() => onStarter(starter.id)}
              >
                <starter.icon className="size-4 text-muted-foreground" />
                <span className="mt-1 text-sm font-medium text-foreground">{starter.title}</span>
                <span className="text-xs font-normal text-muted-foreground">{starter.detail}</span>
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            You can read this conversation, but you cannot send messages.
          </p>
        )}
      </div>
    </div>
  );
}
