import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRightLeft, LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import mistyStill from "@/assets/branding/misty-icon.png?inline";
import { useUserStore } from "@/features/auth/core";
import type { NativeSyncView, SyncTreeView } from "./native";
import { seatText, treeRows } from "./treeControl";

/** Shown when another device took this device's seat: take a workspace back. */
export function DeviceChooseScreen({
  session,
  trees,
  busyTree,
  error,
  onChoose,
}: {
  session: NativeSyncView;
  trees: SyncTreeView;
  busyTree: string | null;
  error: string | null;
  onChoose: (treeId: string) => void;
}) {
  const ownerName = useUserStore((state) => state.me?.name);
  const rows = treeRows(session, trees, ownerName).sort(
    (a, b) => Number(b.local) - Number(a.local),
  );
  const own = rows.find((row) => row.local);
  return (
    <Dialog.Root open modal={false}>
      <Dialog.Portal>
        <div
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 top-[38px] z-[2147483200] bg-black/75 backdrop-blur-sm"
        />
        <Dialog.Content
          data-slot="dialog-content"
          data-device-sync-choose=""
          className="fixed inset-x-0 bottom-0 top-[38px] z-[2147483201] flex flex-col items-center justify-center overflow-y-auto p-8 text-center text-cream outline-none"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <img
            src={mistyStill}
            alt=""
            width={120}
            height={120}
            draggable={false}
            className="mb-5 size-28 select-none object-contain"
          />
          <Dialog.Title className="text-xl font-medium tracking-tight">
            {own?.seat === "other"
              ? `${own.seatName} is using this workspace`
              : "Choose a workspace"}
          </Dialog.Title>
          <Dialog.Description className="mt-3 max-w-sm text-sm leading-relaxed text-cream-muted">
            A workspace can be open on one device at a time. Pick one to continue here.
          </Dialog.Description>
          {trees.displaced_with_edits && (
            <p className="mt-3 max-w-sm text-sm text-cream-muted">
              Changes this device hadn’t sent yet are kept on this device.
            </p>
          )}
          <ul className="mt-6 w-full max-w-sm space-y-2 text-left">
            {rows.map((row) => (
              <li key={row.deviceId}>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-between gap-3 px-4 py-3 text-left"
                  disabled={Boolean(busyTree) || !row.canSwitch}
                  aria-busy={busyTree === row.deviceId}
                  onClick={() => onChoose(row.deviceId)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {row.local ? `Take back ${row.name}’s workspace (this device)` : row.name}
                    </span>
                    <span className="block truncate text-xs text-cream-muted">
                      {[row.os, seatText(row)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {busyTree === row.deviceId ? (
                    <LoaderCircle
                      aria-hidden
                      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <ArrowRightLeft aria-hidden className="size-4 shrink-0" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-4 min-h-10 max-w-sm text-sm" aria-live="polite">
            {error && (
              <p role="alert" className="text-red-300">
                {error}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
