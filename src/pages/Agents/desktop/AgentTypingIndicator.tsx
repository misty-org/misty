import { Avatar, AvatarFallback } from "@/ui";

const dotClass = "size-1.5 rounded-full bg-muted-foreground/75 motion-safe:animate-bounce";

export function AgentTypingIndicator() {
  return (
    <article
      className="mt-5 grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 rounded-md py-1"
      role="status"
      aria-label="Agent is responding"
    >
      <div className="col-start-1 flex justify-end">
        <Avatar className="mt-0.5 size-10">
          <AvatarFallback className="text-xs font-semibold">AI</AvatarFallback>
        </Avatar>
      </div>
      <div className="col-start-2 flex min-w-0 items-center">
        <span className="sr-only">Agent is responding</span>
        <span className="flex h-9 items-center gap-1.5 rounded-2xl bg-muted/70 px-4">
          <span className={`${dotClass} [animation-delay:-300ms]`} />
          <span className={`${dotClass} [animation-delay:-150ms]`} />
          <span className={dotClass} />
        </span>
      </div>
    </article>
  );
}
