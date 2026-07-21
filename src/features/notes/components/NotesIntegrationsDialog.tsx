import type {
  ConnectorCardProps,
  NotesIntegrationsDialogProps,
} from "@/models/interfaces/features/notes/components/NotesIntegrationsDialog";
export type {
  ConnectorCardProps,
  NotesIntegrationsDialogProps,
} from "@/models/interfaces/features/notes/components/NotesIntegrationsDialog";
import { Settings2 } from "lucide-react";
import type { NotesIntegrationCard } from "@/models/interfaces/features/notes/connectors";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  StatusBadge,
} from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";
import { ProviderGlyph, providerStatusPresentation } from "./NoteSourceBadge";

const sectionTitleClass =
  "mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70";

export function NotesIntegrationsDialog(props: NotesIntegrationsDialogProps) {
  const connected = props.adjacent.filter((entry) => entry.availability === "connected");
  const planned = props.adjacent.filter((entry) => entry.availability !== "connected");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[620px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[14px]">Note sources</DialogTitle>
          <DialogDescription className="text-[12px]">
            Connectors that supply notes, plus integrations already connected elsewhere in Misty.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-5 px-5 py-4">
            <section>
              <h3 className={sectionTitleClass}>Note sources</h3>
              <div className="space-y-2">
                {props.connectors.map((connector) => (
                  <ConnectorCard
                    key={connector.id}
                    connector={connector}
                    busy={props.busy}
                    error={props.connectorErrors[connector.id]}
                    onConnect={() => props.onConnect(connector.id)}
                    onDisconnect={() => props.onDisconnect(connector.id)}
                    onConfigure={() => props.onConfigure(connector.id)}
                  />
                ))}
              </div>
            </section>

            {connected.length ? (
              <section>
                <h3 className={sectionTitleClass}>Connected elsewhere</h3>
                <div className="space-y-2">
                  {connected.map((entry) => (
                    <AdjacentCard key={entry.providerId} entry={entry} />
                  ))}
                </div>
              </section>
            ) : null}

            {planned.length ? (
              <section>
                <h3 className={sectionTitleClass}>Coming later</h3>
                <div className="space-y-2">
                  {planned.map((entry) => (
                    <AdjacentCard key={entry.providerId} entry={entry} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorCard(props: ConnectorCardProps) {
  const { connector } = props;
  const status = connector.status();
  const presentation = providerStatusPresentation[status];
  const lastSynced = connector.lastSyncedAt();
  const native = connector.source === "misty";

  return (
    <Card className="border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-muted/40">
          <ProviderGlyph providerId={connector.providerId} size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-[13px] font-medium text-foreground">{connector.name}</h4>
            <StatusBadge status={presentation.tone} dot>
              {presentation.label}
            </StatusBadge>
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {native
              ? "Built in. Notes you write are saved privately on this desktop."
              : "Misty reads selected pages and writes only when you explicitly publish."}
          </p>
          {props.error ? (
            <p className="mt-1 text-[11px] text-amber-500">{props.error}</p>
          ) : lastSynced ? (
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Last synced {relativeTime(lastSynced)}
            </p>
          ) : null}
        </div>

        {!native ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {status === "disconnected" ? (
              <Button type="button" size="sm" disabled={props.busy} onClick={props.onConnect}>
                Connect
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Configure ${connector.name}`}
                  onClick={props.onConfigure}
                >
                  <Settings2 size={13} />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={props.busy}
                  onClick={status === "needs_reconnect" ? props.onConnect : props.onDisconnect}
                >
                  {status === "needs_reconnect" ? "Reconnect" : "Disconnect"}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AdjacentCard(props: { entry: NotesIntegrationCard }) {
  const { entry } = props;
  const planned = entry.availability === "planned";

  return (
    <Card className="border-border bg-card/60 p-3 shadow-none">
      <div className="flex items-center gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/30">
          <ProviderGlyph
            providerId={entry.providerId}
            size={13}
            className={planned ? "opacity-50" : ""}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-[12.5px] font-medium text-foreground/90">{entry.name}</h4>
            {planned ? (
              <StatusBadge status="neutral">Coming later</StatusBadge>
            ) : (
              <StatusBadge status="success" dot>
                Connected
              </StatusBadge>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{entry.description}</p>
        </div>
      </div>
    </Card>
  );
}
