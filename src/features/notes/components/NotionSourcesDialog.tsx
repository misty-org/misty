import { useEffect, useState } from "react";
import { Database, FileText, LoaderCircle } from "lucide-react";

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from "@/ui";
import type {
  NotesConnector,
  NoteSourceOption,
} from "@/models/interfaces/features/notes/connectors";

/**
 * Chooses which Notion pages and databases a Space reads as notes.
 *
 * Misty never ingests a whole Notion workspace: a source is only read after
 * someone picks it here, which keeps the note list intentional and the API cost
 * proportional to what the team actually uses.
 */
export function NotionSourcesDialog({
  open,
  connector,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  connector?: NotesConnector;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [sources, setSources] = useState<NoteSourceOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !connector?.listSources) return;
    setLoading(true);
    setError("");
    setSelected(connector.selectedSourceIds?.() ?? []);
    connector
      .listSources()
      .then(setSources)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Misty could not reach Notion."),
      )
      .finally(() => setLoading(false));
  }, [connector, open]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const save = async () => {
    if (!connector?.selectSources) return;
    setSaving(true);
    setError("");
    try {
      await connector.selectSources(selected);
      onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Misty could not save these sources.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-[14px]">Notion sources</DialogTitle>
          <DialogDescription className="text-[12px]">
            Pick the pages and databases this Space reads as notes.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-1 px-5 py-4">
            {loading ? (
              <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Loading your Notion workspace…
              </p>
            ) : error ? (
              <p className="m-0 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : !sources.length ? (
              <p className="m-0 text-sm text-muted-foreground">
                Misty cannot see any Notion pages yet. Share a page or database with the Misty
                integration in Notion, then reopen this dialog.
              </p>
            ) : (
              sources.map((source) => (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
                  key={source.id}
                >
                  <Checkbox
                    checked={selected.includes(source.id)}
                    onCheckedChange={() => toggle(source.id)}
                    aria-label={source.title}
                  />
                  {source.kind === "database" ? (
                    <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate">{source.title}</span>
                  {source.parentTitle ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {source.parentTitle}
                    </span>
                  ) : null}
                </label>
              ))
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving || loading} onClick={() => void save()}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            Save sources
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
