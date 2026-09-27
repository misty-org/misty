import { SupportRecoverySection } from "@/features/support";
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, IconButton } from "@/shared/ui";
import { CircleHelp } from "lucide-react";
import { useState } from "react";

/** Help belongs to the account dock, independently of workspace preferences. */
export function HelpMenu({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <IconButton label="Help" tooltip={false} className={className}>
          <CircleHelp aria-hidden="true" />
        </IconButton>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="app-pages-root flex max-h-[min(760px,calc(100dvh-4rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-charcoal-border px-5 py-5 pr-16">
          <DialogTitle className="text-base font-semibold">Help</DialogTitle>
          {import.meta.env.DEV ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void openUiGallery(() => setOpen(false))}
            >
              UI gallery
            </Button>
          ) : null}
        </header>
        <div className="misty-scrollbar min-h-0 overflow-y-auto overscroll-contain p-5">
          <SupportRecoverySection onClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Dev-only: the router is imported on demand so Help stays free of the route tree. */
async function openUiGallery(close: () => void) {
  close();
  const { router } = await import("@/app/routing/RouteConfig");
  await router.navigate("/dev/ui");
}
