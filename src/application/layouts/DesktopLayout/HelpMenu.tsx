import { SupportRecoverySection } from "@/features/support";
import { Dialog, DialogContent, DialogTitle, DialogTrigger, Button } from "@/shared/ui";
import { CircleHelp } from "lucide-react";
import { useState } from "react";

/** Help belongs to the account dock, independently of workspace preferences. */
export function HelpMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={className}
          aria-label="Help"
          title="Help"
        >
          <CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="app-pages-root flex max-h-[min(760px,calc(100dvh-4rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <header className="shrink-0 border-b border-charcoal-border px-5 py-5 pr-16">
          <DialogTitle className="text-base font-semibold">Help</DialogTitle>
        </header>
        <div className="misty-scrollbar min-h-0 overflow-y-auto overscroll-contain p-5">
          <SupportRecoverySection onClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
