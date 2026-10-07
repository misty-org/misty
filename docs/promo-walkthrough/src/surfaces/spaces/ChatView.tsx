import { AtSign, ChevronDown, Ellipsis, FileText, SendHorizontal, Smile } from "lucide-react";
import { chat, people } from "../../data/project";

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-charcoal-border bg-[#181818] text-xs font-semibold text-cream">
      {initials}
    </span>
  );
}

/** The Space's "Everyone" conversation, laid out like ChatMessageRow. */
export function ChatView({ count = chat.length }: { count?: number }) {
  return (
    <div className="flex h-full flex-col bg-[#101010]">
      <div className="flex h-12 shrink-0 items-center border-b border-charcoal-border px-6">
        <span className="flex items-center gap-1.5 text-sm font-medium text-cream">
          Everyone <ChevronDown className="size-3.5" aria-hidden />
        </span>
        <Ellipsis className="ml-auto size-4 text-cream-muted" aria-hidden />
      </div>
      <div className="flex-1 px-6 pt-6">
        <div className="mb-5 flex items-center gap-4 text-xs font-medium text-cream-muted">
          <span className="h-px flex-1 bg-charcoal-border" />
          Thursday, October 2
          <span className="h-px flex-1 bg-charcoal-border" />
        </div>
        <div className="space-y-5">
          {chat.slice(0, count).map((message, index) => (
            <div key={index} className="flex gap-3.5" data-t={`chat-${index}`}>
              <Avatar initials={people[message.who].initials} />
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-[15px] font-semibold text-cream-bright">{people[message.who].name}</span>
                  <span className="text-xs text-cream-muted">{message.time}</span>
                </p>
                <p className="mt-0.5 text-[15px] text-cream">{message.text}</p>
                {index === 0 && (
                  <span
                    data-t="chat-note-link"
                    className="mt-2.5 flex w-72 items-center gap-3 rounded-lg border border-charcoal-border bg-charcoal-card px-3 py-2.5"
                  >
                    <span className="grid size-8 place-items-center rounded-md border border-charcoal-border text-cream-muted">
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm text-cream-bright">Homepage copy</span>
                      <span className="block text-xs text-cream-muted">Note · Journal</span>
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-6 mb-5 flex h-14 items-center rounded-xl border border-charcoal-border bg-charcoal-card px-4 text-sm text-cream-muted">
        Write a message…
        <span className="ml-auto flex items-center gap-3">
          <AtSign className="size-4" aria-hidden />
          <Smile className="size-4" aria-hidden />
          <span className="grid size-8 place-items-center rounded-lg bg-charcoal-active text-cream">
            <SendHorizontal className="size-4" aria-hidden />
          </span>
        </span>
      </div>
    </div>
  );
}
