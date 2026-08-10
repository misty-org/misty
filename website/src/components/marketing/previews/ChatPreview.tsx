import { cn } from "@/lib/utils";
import { ProductFrame } from "./ProductFrame";

const messages = [
  {
    initials: "AM",
    name: "Alex",
    text: "The launch brief is ready. I marked the two open decisions.",
  },
  {
    initials: "JR",
    name: "Jordan",
    text: "I’ll take onboarding. Can we confirm the release date today?",
  },
];

const channels = ["Everyone", "Design", "Release"];

export function ChatPreview() {
  return (
    <ProductFrame title="Launch plan" meta="4 members">
      <div className="grid min-h-[22rem] sm:grid-cols-[10rem_1fr]">
        <div className="hidden border-r border-border bg-muted/25 p-3 sm:block">
          <p className="px-2 py-2 text-[11px] font-medium text-muted-foreground">
            Conversations
          </p>
          {channels.map((channel, index) => (
            <div
              key={channel}
              className={cn(
                "mt-1 rounded-md px-3 py-2 text-xs",
                index === 0
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground",
              )}
            >
              {channel}
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col p-4 sm:p-5">
          <div className="flex-1 space-y-5">
            {messages.map((message) => (
              <div key={message.name} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                  {message.initials}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {message.name}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {message.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Message this Space
          </div>
        </div>
      </div>
    </ProductFrame>
  );
}
