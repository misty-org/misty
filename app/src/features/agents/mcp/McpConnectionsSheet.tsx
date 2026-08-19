import { useAuth } from "@/features/auth";
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
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";
import { Cable, LoaderCircle, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { publicMcpOrigin, validRemoteMcpEndpoint } from "./normalization";
import type { McpConnection } from "./types";
import { useMcpConnectionsStore } from "./useMcpConnectionsStore";
import { McpAgentToolsPanel } from "./McpAgentToolsPanel";

export function McpConnectionsSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId?: string;
}) {
  const { user } = useAuth();
  const store = useMcpConnectionsStore();
  const { load } = store;
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (props.open && user?.id) void load(user.id, true);
  }, [load, props.open, user?.id]);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-[min(720px,96vw)] overflow-y-auto bg-charcoal-bg sm:max-w-[720px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>Tool connections</SheetTitle>
          <SheetDescription>
            Connect remote MCP tool servers, then choose exactly what each Agent may request.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-charcoal-border bg-charcoal-card p-3">
          <Server className="mt-0.5 size-4 shrink-0 text-cream-muted" aria-hidden />
          <div>
            <p className="m-0 text-xs font-medium text-cream">Remote connections only</p>
            <p className="mt-1 text-xs text-cream-muted">
              Tools run through Misty’s server. Access tokens are sent once and never returned or
              saved on this device.
            </p>
          </div>
        </div>

        <section className="mt-5">
          <header className="flex items-center justify-between gap-3">
            <div>
              <h3 className="m-0 text-sm font-medium text-cream-bright">Connections</h3>
              <p className="mt-1 text-xs text-cream-muted">Every discovered tool starts off.</p>
            </div>
            <Button size="sm" onClick={() => setAdding((current) => !current)}>
              <Plus className="size-4" /> Add connection
            </Button>
          </header>
          {adding ? <AddConnectionForm onDone={() => setAdding(false)} /> : null}
          {store.loading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-cream-muted">
              <LoaderCircle className="size-4 animate-spin" /> Loading connections…
            </div>
          ) : !store.connections.length ? (
            <p className="mt-3 rounded-lg border border-dashed border-charcoal-border p-4 text-sm text-cream-muted">
              No remote tool servers are connected yet.
            </p>
          ) : (
            <div className="mt-3 grid gap-3">
              {store.connections.map((connection) => (
                <ConnectionCard key={connection.id} connection={connection} />
              ))}
            </div>
          )}
        </section>

        {props.agentId ? (
          <div className="mt-6 border-t border-charcoal-border pt-5">
            <McpAgentToolsPanel agentId={props.agentId} compact />
          </div>
        ) : null}

        {store.error ? (
          <p
            className="mt-4 rounded-lg border border-[#d68b80]/30 bg-[#d68b80]/5 p-3 text-xs text-[#d68b80]"
            role="alert"
          >
            {store.error}
          </p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const store = useMcpConnectionsStore();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const validEndpoint = useMemo(() => validRemoteMcpEndpoint(url), [url]);

  const submit = async () => {
    if (!name.trim() || !validEndpoint) return;
    try {
      await store.add({
        name: name.trim(),
        endpoint_url: url.trim(),
        bearer_token: token || undefined,
      });
      setName("");
      setUrl("");
      setToken("");
      onDone();
    } catch {
      setToken("");
    }
  };

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-charcoal-border bg-charcoal-card p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-name">Name</Label>
        <Input
          id="mcp-name"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Design tools"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-url">Server URL</Label>
        <Input
          id="mcp-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://tools.example.com/mcp"
        />
        {url.trim() && !validEndpoint ? (
          <span className="text-xs text-[#d68b80]">
            Enter a fixed HTTPS URL without credentials, query text, or a fragment.
          </span>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mcp-token">Access token (optional)</Label>
        <Input
          id="mcp-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <span className="text-xs text-cream-muted">
          Sent once to Misty’s server and never returned.
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!name.trim() || !validEndpoint || store.busy === "add"}
          onClick={() => void submit()}
        >
          {store.busy === "add" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Cable className="size-4" />
          )}
          Connect
        </Button>
      </div>
    </div>
  );
}

function ConnectionCard({ connection }: { connection: McpConnection }) {
  const store = useMcpConnectionsStore();
  const tools = store.tools.filter((tool) => tool.connection_id === connection.id);
  const busy = store.busy.endsWith(`:${connection.id}`);
  return (
    <article className="rounded-lg border border-charcoal-border bg-charcoal-card p-4">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="m-0 truncate text-sm font-medium text-cream">{connection.name}</h4>
            <Badge variant={connection.status === "active" ? "secondary" : "outline"}>
              {statusLabel(connection.status)}
            </Badge>
            <Badge variant="outline">Remote</Badge>
          </div>
          <p className="mt-1 truncate text-xs text-cream-muted">
            {publicMcpOrigin(connection.endpoint_url) || "Secure remote server"} ·{" "}
            {tools.length || connection.tool_count} tools
          </p>
          {connection.last_checked_at ? (
            <p className="mt-1 text-[11px] text-cream-muted">
              Checked {new Date(connection.last_checked_at).toLocaleString()}
            </p>
          ) : null}
        </div>
      </header>
      {connection.status === "needs_attention" ? (
        <p className="mt-3 text-xs text-[#d68b80]">
          This connection needs attention. Check it again before enabling tools.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void store.test(connection.id)}
        >
          <RefreshCw className="size-4" /> Check connection
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void store.discover(connection.id)}
        >
          <Search className="size-4" /> Find tools
        </Button>
        <RemoveConnection connection={connection} />
      </div>
    </article>
  );
}

function RemoveConnection({ connection }: { connection: McpConnection }) {
  const store = useMcpConnectionsStore();
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" /> Remove
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this tool connection?</AlertDialogTitle>
          <AlertDialogDescription>
            “{connection.name}” will be removed from every Agent. Existing audit history remains.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void store.remove(connection.id)}>
            Remove connection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function statusLabel(status: McpConnection["status"]): string {
  if (status === "active") return "Connected";
  if (status === "needs_attention") return "Needs attention";
  if (status === "unchecked") return "Not checked";
  return "Revoked";
}
