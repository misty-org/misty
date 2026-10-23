import { Check, Copy, ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";
import { useWorkspaceStore } from "@/features/workspace";
import { Badge, Button, cn } from "@/shared/ui";
import { formatWhen } from "./format";
import { type MemoryNode, sourceLabels } from "./model";
import { NodeGlyph } from "./nodes/NodeGlyph";
import { useMemoryTreeStore } from "./useMemoryTreeStore";

/** One memory, beside its node: what it says, where it came from, and what you can do with it. */
export function MemoryPopover({ node }: { node: MemoryNode }) {
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const body = node.text || node.preview || "";

  const copy = () => {
    void navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const forget = async () => {
    try {
      await useMemoryTreeStore.getState().forget(node.id);
    } catch {
      setError("Memory couldn't forget that. Try again.");
      setConfirming(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <NodeGlyph node={node} className="mt-0.5" />
        <h2 className="m-0 line-clamp-2 min-w-0 text-[13px] font-medium leading-5 text-cream-bright">
          {node.label}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {node.source && sourceLabels[node.source] && (
          <Badge variant="outline">{sourceLabels[node.source]}</Badge>
        )}
        {node.detail && <Badge variant="outline">{node.detail}</Badge>}
        <span className="text-[11px] text-cream-muted">{formatWhen(node.last_at)}</span>
      </div>
      {body && (
        <p
          className={cn(
            "m-0 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border p-2.5",
            "border-charcoal-border bg-charcoal-card text-xs leading-5 text-cream-muted",
          )}
        >
          {body}
        </p>
      )}
      <p className="m-0 text-[11px] text-cream-muted">
        {node.searchable
          ? "Searchable by you and your agents."
          : "Not searchable yet. New memories are indexed within the hour."}
      </p>
      {error && (
        <p role="alert" className="m-0 text-xs text-cream-muted">
          {error}
        </p>
      )}
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-xs text-cream">
            Forget this memory? It leaves search and your agents.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void forget()}>
              Forget
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {node.url && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => useWorkspaceStore.getState().openBrowserView({ url: node.url! })}
            >
              <ExternalLink aria-hidden="true" />
              Open
            </Button>
          )}
          {body && (
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden="true" />
            Forget
          </Button>
        </div>
      )}
    </div>
  );
}
