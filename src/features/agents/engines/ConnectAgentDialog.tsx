import { Copy, Plug, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@/native/invoke";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  ErrorNotification,
  IconButton,
  Input,
  Skeleton,
  Textarea,
} from "@/shared/ui";
import { agentAccountId } from "../personal/agentAccount";
import { currentSpaceKey } from "./enginesApi";

interface Connection {
  id: string;
  name: string;
  createdAt: number;
}
interface Listed {
  url: string | null;
  connections: Connection[];
}
interface Created {
  id: string;
  name: string;
  url: string;
  token: string;
}

/** What an agent's settings need to reach the Space, in the shape most MCP clients take. */
export const connectionConfig = (made: Pick<Created, "url" | "token">) =>
  JSON.stringify(
    {
      mcpServers: {
        misty: {
          type: "http",
          url: made.url,
          headers: { Authorization: `Bearer ${made.token}` },
        },
      },
    },
    null,
    2,
  );

const copy = (text: string) => void navigator.clipboard.writeText(text).catch(() => undefined);

/**
 * Connects an agent Misty doesn't start (Cursor, the Claude app, any MCP client on this
 * computer) to the Space this window shows. Each connection has its own token, shown once, and
 * can be removed. A connected agent reads the Space freely and asks before every change.
 */
export function ConnectAgentButton() {
  const [open, setOpen] = useState(false);
  const [listed, setListed] = useState<Listed | null>(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const space = currentSpaceKey();
  const load = useCallback(
    () =>
      invoke<Listed>("space_connection_list", { account: agentAccountId(), space })
        .then(setListed)
        .catch((reason) => setError(String(reason))),
    [space],
  );
  useEffect(() => {
    if (!open) return;
    setMade(null);
    setListed(null);
    void load();
  }, [open, load]);
  const create = () => {
    setBusy(true);
    void invoke<Created>("space_connection_create", { account: agentAccountId(), space, name })
      .then((created) => {
        setMade(created);
        setName("");
        return load();
      })
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
  const remove = (id: string) =>
    void invoke<void>("space_connection_revoke", { account: agentAccountId(), id })
      .then(load)
      .catch((reason) => setError(String(reason)));
  return (
    <>
      <IconButton label="Connect an agent" onClick={() => setOpen(true)}>
        <Plug size={16} />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} className="grid gap-4">
          <DialogTitle>Connect an agent to this Space</DialogTitle>
          {made ? (
            <div className="grid gap-2">
              <p className="text-sm text-cream">
                Add this to {made.name}&apos;s MCP settings. The token is shown only now.
              </p>
              <Textarea
                aria-label="Connection settings"
                readOnly
                className="min-h-44 font-mono text-xs"
                value={connectionConfig(made)}
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={() => copy(connectionConfig(made))}>
                  <Copy size={14} />
                  Copy settings
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setMade(null)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <Input
                aria-label="Agent name"
                placeholder="Cursor, Claude, another agent"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button type="submit" disabled={busy || !name.trim()}>
                Connect
              </Button>
            </form>
          )}
          {!listed ? (
            <div className="grid gap-2" aria-hidden="true">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : listed.connections.length ? (
            <ul className="grid gap-1">
              {listed.connections.map((connection) => (
                <li key={connection.id} className="flex items-center gap-2 text-sm text-cream">
                  <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                  <span className="shrink-0 text-xs text-cream-muted">
                    {new Date(connection.createdAt).toLocaleDateString()}
                  </span>
                  <IconButton
                    label={`Remove ${connection.name}`}
                    onClick={() => remove(connection.id)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
          <ErrorNotification message={error} onDismiss={() => setError("")} />
        </DialogContent>
      </Dialog>
    </>
  );
}
