import {
  figmaFileUrl,
  type FigmaBinding,
  type FigmaBindingContext,
  type FigmaContentRecord,
} from "@/api/integrations/figma";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Input,
  Textarea,
} from "@/shared/ui";
import {
  ExternalLink,
  Import,
  LoaderCircle,
  MessageSquare,
  Radio,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toFigmaCanvasReference, type FigmaCanvasReference } from "./figmaCanvasReference";
import { contextKey, useFigmaDrawingsStore } from "./useFigmaDrawingsStore";

export function FigmaBindingCard(props: {
  spaceId: string;
  binding: FigmaBinding;
  canManage: boolean;
  onImport?: (reference: FigmaCanvasReference) => void;
}) {
  const store = useFigmaDrawingsStore();
  const records = useMemo(
    () => store.recordsByBinding[props.binding.id] ?? [],
    [props.binding.id, store.recordsByBinding],
  );
  const fileRecords = useMemo(
    () => uniqueFiles(records.filter((record) => record.record_type === "file")),
    [records],
  );
  const [fileKey, setFileKey] = useState(props.binding.file_key ?? fileRecords[0]?.file_key ?? "");
  const requestedKey = props.binding.resource_type === "file" ? "" : fileKey;
  const context = store.contextByBinding[contextKey(props.binding.id, requestedKey)];
  const account = store.accounts.find((item) => item.id === props.binding.connection_id);
  const canComment =
    props.canManage && account?.capabilities?.includes("drawings_comments") === true;
  const canEnableLiveSync =
    props.canManage && account?.capabilities?.includes("drawings_webhooks") === true;
  const liveSubscriptionCount = store.liveSyncByBinding[props.binding.id];
  const busy = store.busy.endsWith(`:${props.binding.id}`);

  const loadContext = () => store.context(props.spaceId, props.binding.id, requestedKey);
  const importReference = async () => {
    if (!props.onImport) return;
    const loaded = context ?? (await loadContext());
    if (!loaded) return;
    props.onImport(toFigmaCanvasReference(props.binding.id, loaded, figmaFileUrl(loaded.file.key)));
  };

  return (
    <article className="rounded-xl border border-charcoal-border bg-charcoal-card p-4">
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-medium text-cream-bright">
              {props.binding.display_name}
            </h4>
            <Badge variant="outline">Figma</Badge>
            <Badge variant={props.binding.status === "active" ? "secondary" : "outline"}>
              {statusLabel(props.binding.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-cream-muted">
            {props.binding.resource_type === "file" ? "File" : "Project"}
            {props.binding.last_synced_at
              ? ` · Synced ${new Date(props.binding.last_synced_at).toLocaleString()}`
              : " · Not synced yet"}
          </p>
        </div>
        {props.binding.file_key ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void openExternalLink(figmaFileUrl(props.binding.file_key!))}
          >
            <ExternalLink className="size-4" /> Open
          </Button>
        ) : null}
      </header>

      {props.binding.status === "needs_attention" ? (
        <p className="mt-3 rounded-md border border-[#d68b80]/30 bg-[#d68b80]/5 p-2 text-xs text-[#d68b80]">
          This source needs attention. A Space manager can reconnect its Figma account.
        </p>
      ) : null}
      {liveSubscriptionCount !== undefined ? (
        <p className="mt-3 rounded-md border border-status-green/20 bg-status-green/5 p-2 text-xs text-sage-fg">
          Live sync active · {liveSubscriptionCount} Figma event
          {liveSubscriptionCount === 1 ? "" : "s"}
        </p>
      ) : null}

      {props.binding.resource_type === "project" ? (
        <div className="mt-3 grid gap-1.5">
          <span className="text-xs font-medium text-cream">Project files</span>
          {!fileRecords.length ? (
            <p className="m-0 text-xs text-cream-muted">No readable files were returned.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fileRecords.map((record) => (
                <Button
                  key={record.file_key}
                  size="sm"
                  variant={fileKey === record.file_key ? "secondary" : "outline"}
                  onClick={() => setFileKey(record.file_key)}
                >
                  {record.title || record.file_key}
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || (props.binding.resource_type === "project" && !fileKey)}
          onClick={() => void loadContext()}
        >
          {store.busy === `context:${props.binding.id}` ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : null}
          View context
        </Button>
        {props.onImport ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || (props.binding.resource_type === "project" && !fileKey)}
            onClick={() => void importReference()}
          >
            <Import className="size-4" /> Import to this drawing
          </Button>
        ) : null}
        {props.canManage ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void store.sync(props.spaceId, props.binding.id)}
          >
            <RefreshCw className="size-4" /> Sync
          </Button>
        ) : null}
        {canEnableLiveSync ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void store.reconcileWebhooks(props.spaceId, props.binding.id)}
          >
            <Radio className="size-4" /> Start live sync
          </Button>
        ) : null}
        {props.canManage ? <UnbindButton spaceId={props.spaceId} binding={props.binding} /> : null}
      </div>

      {context ? (
        <ContextPanel
          context={context}
          canComment={canComment}
          busy={store.busy === `comment:${props.binding.id}`}
          onComment={(message, nodeId, idempotencyKey) =>
            store.comment(
              props.spaceId,
              props.binding.id,
              requestedKey,
              message,
              nodeId,
              idempotencyKey,
            )
          }
        />
      ) : (
        <RecordProvenance records={records} />
      )}
    </article>
  );
}

function ContextPanel(props: {
  context: FigmaBindingContext;
  canComment: boolean;
  busy: boolean;
  onComment: (message: string, nodeId: string, idempotencyKey: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const send = async () => {
    try {
      await props.onComment(message.trim(), nodeId.trim(), idempotencyKey);
      setConfirmOpen(false);
      setIdempotencyKey("");
      setMessage("");
      setNodeId("");
    } catch {}
  };

  return (
    <section className="mt-4 border-t border-charcoal-border pt-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h5 className="truncate text-sm font-medium text-cream">{props.context.file.name}</h5>
          <p className="mt-1 text-xs text-cream-muted">
            Version {props.context.file.version} · {props.context.file.editor_type || "Figma"} ·
            Source: Figma
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void openExternalLink(figmaFileUrl(props.context.file.key))}
        >
          <ExternalLink className="size-4" /> Source
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-cream-muted">
        <span>{props.context.versions.length} versions</span>
        <span>{props.context.comments.length} comments</span>
      </div>
      {props.context.comments.slice(0, 3).map((comment) => (
        <div key={comment.id} className="mt-2 rounded-md border border-charcoal-border p-2">
          <p className="m-0 line-clamp-3 text-xs text-cream">{comment.message}</p>
          <p className="mt-1 text-[11px] text-cream-muted">
            Figma · {new Date(comment.created_at).toLocaleString()}
          </p>
        </div>
      ))}
      {props.canComment ? (
        <div className="mt-3 grid gap-2">
          <Textarea
            aria-label="Figma comment"
            maxLength={5000}
            placeholder="Write a comment…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Input
            aria-label="Figma node ID (optional)"
            maxLength={256}
            placeholder="Node ID (optional)"
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
          />
          <Button
            size="sm"
            className="justify-self-start"
            disabled={!message.trim() || props.busy}
            onClick={() => {
              setIdempotencyKey(crypto.randomUUID());
              setConfirmOpen(true);
            }}
          >
            <MessageSquare className="size-4" /> Review comment
          </Button>
          <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => {
              if (props.busy) return;
              setConfirmOpen(open);
              if (!open) setIdempotencyKey("");
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Post this comment to Figma?</AlertDialogTitle>
                <AlertDialogDescription>
                  File: {props.context.file.name} ({props.context.file.key})
                  <br />
                  Node: {nodeId.trim() || "Entire file"}
                </AlertDialogDescription>
                <blockquote className="max-h-40 overflow-y-auto rounded-md border border-charcoal-border p-3 text-sm text-cream">
                  {message.trim()}
                </blockquote>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={props.busy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={props.busy || !message.trim()}
                  onClick={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  {props.busy ? "Posting…" : "Post to Figma"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </section>
  );
}

function RecordProvenance({ records }: { records: FigmaContentRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="mt-3 border-t border-charcoal-border pt-3">
      <p className="m-0 text-xs font-medium text-cream">Recent Figma context</p>
      {records.slice(0, 4).map((record) => (
        <div key={record.id} className="mt-2 flex items-center gap-2 text-xs text-cream-muted">
          <Badge variant="outline">{record.record_type}</Badge>
          <span className="min-w-0 flex-1 truncate">{record.title || record.external_id}</span>
          <span>{record.actor_name || "Figma"}</span>
        </div>
      ))}
    </div>
  );
}

function UnbindButton(props: { spaceId: string; binding: FigmaBinding }) {
  const store = useFigmaDrawingsStore();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Remove
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this Figma source?</AlertDialogTitle>
          <AlertDialogDescription>
            Misty will stop syncing “{props.binding.display_name}”. Native drawings and imported
            reference cards remain unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void store.unbind(props.spaceId, props.binding.id)}>
            Remove source
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function uniqueFiles(records: FigmaContentRecord[]): FigmaContentRecord[] {
  return Array.from(new Map(records.map((record) => [record.file_key, record])).values());
}

function statusLabel(status: FigmaBinding["status"]): string {
  if (status === "active") return "Synced";
  if (status === "needs_attention") return "Needs attention";
  if (status === "disabled") return "Disabled";
  return "Connecting";
}
