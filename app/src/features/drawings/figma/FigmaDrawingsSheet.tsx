import { connectionsApi, type AccountConnection } from "@/api/connections";
import { useAuth } from "@/features/auth";
import { SystemErrorActivity } from "@/features/activity";
import { openProviderAuthorizationLink } from "@/shared/platform/openExternalLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";
import { LoaderCircle, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { FaFigma } from "react-icons/fa6";
import { FigmaBindingCard } from "./FigmaBindingCard";
import { FigmaSourcePicker } from "./FigmaSourcePicker";
import { useFigmaDrawingsStore } from "./useFigmaDrawingsStore";
import type { FigmaCanvasReference } from "./figmaCanvasReference";

const FIGMA_READ_CAPABILITIES = ["drawings_read"] as const;

export function FigmaDrawingsSheet(props: {
  spaceId: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport?: (reference: FigmaCanvasReference) => void;
}) {
  const { user } = useAuth();
  const state = useFigmaDrawingsStore();
  const { load, reset } = state;
  const [authorizationError, setAuthorizationError] = useState("");

  useEffect(() => {
    if (!props.open || !user?.id) return;
    void load(user.id, props.spaceId);
  }, [load, props.open, props.spaceId, user?.id]);

  useEffect(() => {
    if (!props.open || !user?.id) return;
    const refresh = () => void load(user.id, props.spaceId);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load, props.open, props.spaceId, user?.id]);

  useEffect(() => () => reset(), [reset, user?.id]);

  const authorize = async (capabilities: Array<"drawings_comments" | "drawings_webhooks"> = []) => {
    if (!props.canManage) return;
    setAuthorizationError("");
    try {
      const start = await connectionsApi.authorize(
        "figma",
        [...FIGMA_READ_CAPABILITIES, ...capabilities],
        `/spaces/${props.spaceId}/drawings`,
      );
      await openProviderAuthorizationLink(start.authorization_url);
    } catch (error) {
      setAuthorizationError(
        error instanceof Error ? error.message : "Figma authorization could not be opened.",
      );
    }
  };

  const activeAccounts = state.accounts.filter((account) => account.status === "active");

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-[min(700px,96vw)] overflow-y-auto bg-charcoal-bg sm:max-w-[700px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Figma for Drawings</SheetTitle>
          <SheetDescription>
            Keep Misty canvases native while bringing in selected Figma file context, versions, and
            comments.
          </SheetDescription>
        </SheetHeader>

        <section className="mt-5 rounded-xl border border-charcoal-border bg-charcoal-card">
          <header className="flex items-center justify-between gap-3 border-b border-charcoal-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <FaFigma className="size-5 text-cream-bright" aria-hidden />
              <div>
                <h3 className="text-sm font-medium text-cream-bright">Figma account</h3>
                <p className="mt-0.5 text-xs text-cream-muted">
                  OAuth credentials stay on the server
                </p>
              </div>
            </div>
            {props.canManage ? (
              <Button size="sm" onClick={() => void authorize()}>
                {state.accounts.length ? "Add account" : "Connect"}
              </Button>
            ) : null}
          </header>
          {state.loading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-cream-muted">
              <LoaderCircle className="size-4 animate-spin" /> Checking Figma…
            </div>
          ) : !state.accounts.length ? (
            <p className="m-0 p-4 text-sm text-cream-muted">
              {props.canManage
                ? "Connect Figma to link a file by URL or key."
                : "A Space manager has not connected a Figma source yet."}
            </p>
          ) : (
            <div className="divide-y divide-charcoal-border">
              {state.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  canManage={props.canManage}
                  reconnect={authorize}
                  enableComments={() => authorize(["drawings_comments"])}
                  enableLiveSync={() => authorize(["drawings_webhooks"])}
                />
              ))}
            </div>
          )}
        </section>

        {props.canManage && activeAccounts.length ? (
          <FigmaSourcePicker spaceId={props.spaceId} accounts={activeAccounts} />
        ) : null}

        <section className="mt-5 grid gap-3" aria-label="Linked Figma sources">
          <header>
            <h3 className="text-sm font-medium text-cream-bright">Linked sources</h3>
            <p className="mt-1 text-xs text-cream-muted">
              Read-only context appears beside your native Misty drawings.
            </p>
          </header>
          {!state.bindings.length ? (
            <p className="m-0 rounded-lg border border-charcoal-border bg-charcoal-card p-4 text-sm text-cream-muted">
              No Figma files are linked to this Space.
            </p>
          ) : (
            state.bindings.map((binding) => (
              <FigmaBindingCard
                key={binding.id}
                spaceId={props.spaceId}
                binding={binding}
                canManage={props.canManage}
                onImport={props.onImport}
              />
            ))
          )}
        </section>

        {state.error || authorizationError ? (
          <SystemErrorActivity
            error={state.error || authorizationError}
            scope={`figma:${props.spaceId}`}
            title="Figma could not be refreshed"
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AccountRow(props: {
  account: AccountConnection;
  canManage: boolean;
  reconnect: () => Promise<void>;
  enableComments: () => Promise<void>;
  enableLiveSync: () => Promise<void>;
}) {
  const store = useFigmaDrawingsStore();
  const active = props.account.status === "active";
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-sm text-cream">
        {props.account.account_display}
      </span>
      <Badge variant={active ? "secondary" : "outline"}>
        {active
          ? "Connected"
          : props.account.status === "needs_attention"
            ? "Reconnect"
            : "Revoked"}
      </Badge>
      {props.canManage && !active ? (
        <Button size="sm" variant="outline" onClick={() => void props.reconnect()}>
          Reconnect
        </Button>
      ) : null}
      {props.canManage && active && !props.account.capabilities?.includes("drawings_comments") ? (
        <Button size="sm" variant="outline" onClick={() => void props.enableComments()}>
          Enable comments
        </Button>
      ) : null}
      {props.canManage && active && !props.account.capabilities?.includes("drawings_webhooks") ? (
        <div className="w-full rounded-md border border-charcoal-border p-2">
          <Button size="sm" variant="outline" onClick={() => void props.enableLiveSync()}>
            Enable live sync
          </Button>
          <p className="mt-1.5 text-[11px] text-cream-muted">
            The connected Figma user must have Can edit access to create a webhook. The webhook
            scope does not let Misty edit file content.
          </p>
        </div>
      ) : null}
      {props.canManage ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Unplug className="size-4" /> Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect this Figma account?</AlertDialogTitle>
              <AlertDialogDescription>
                Linked Figma sources will stop updating through this account. Native drawings and
                imported reference cards are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void store.disconnect(props.account.id)}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
