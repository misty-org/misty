import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  ListRow,
  MenuItem,
  notify,
  SectionHeading,
  useConfirmDelete,
} from "@/shared/ui";
import {
  failureText,
  marketApi,
  unaddedSuggestions,
  type EngineMarket,
  type MarketEngine,
} from "./api";

/** The marketplaces an engine reads plugins from, with adding and removing one. */
export function SourcesDialog({
  open,
  onOpenChange,
  engine,
  name,
  market,
  onChanged,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  engine: MarketEngine;
  name: string;
  market: EngineMarket;
  onChanged(): Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The source being added: the typed one, or a suggestion's. */
  const [adding, setAdding] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDelete();
  const suggestions = unaddedSuggestions(engine, market.sources);

  const add = async (from: string, typed: boolean) => {
    setAdding(from);
    setError(null);
    try {
      await marketApi.addSource(engine, from);
      if (typed) setSource("");
      await onChanged();
    } catch (reason) {
      const message = failureText(reason, "That marketplace couldn't be added.");
      if (typed) setError(message);
      else notify({ message, tone: "error" });
    } finally {
      setAdding(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{name} marketplaces</DialogTitle>
          <DialogDescription>{name} lists and installs plugins from these.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <ul className="grid">
            {market.sources.map((entry) => (
              <li key={entry.name} className="list-none">
                <ListRow
                  label={entry.name}
                  description={entry.location}
                  menu={
                    <MenuItem
                      icon={Trash2}
                      label="Remove"
                      danger
                      onSelect={() =>
                        void confirm({
                          title: `Remove ${entry.name}?`,
                          what: `${name} stops listing its plugins. Plugins already installed from it stay.`,
                          confirmLabel: "Remove",
                          onConfirm: async () => {
                            try {
                              await marketApi.removeSource(engine, entry.name);
                              await onChanged();
                            } catch (reason) {
                              notify({
                                message: failureText(reason, `${entry.name} couldn't be removed.`),
                                tone: "error",
                              });
                            }
                          },
                        })
                      }
                    />
                  }
                />
              </li>
            ))}
          </ul>
          {suggestions.length ? (
            <section aria-labelledby="suggested-marketplaces" className="grid gap-1">
              <SectionHeading id="suggested-marketplaces" title="Suggested" as="h3" />
              <ul className="grid">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.source} className="list-none">
                    <ListRow
                      label={suggestion.name}
                      description={`${suggestion.line} · ${suggestion.source}`}
                      trailing={
                        <Button
                          size="sm"
                          icon={Plus}
                          loading={adding === suggestion.source}
                          disabled={adding !== null}
                          onClick={() => void add(suggestion.source, false)}
                        >
                          Add
                        </Button>
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (source.trim()) void add(source.trim(), true);
            }}
          >
            <Field label="Add a marketplace" error={error ?? undefined} className="min-w-0 flex-1">
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="owner/repo or https:// address"
              />
            </Field>
            <Button
              type="submit"
              icon={Plus}
              loading={adding === source.trim()}
              disabled={!source.trim() || adding !== null}
            >
              Add
            </Button>
          </form>
        </DialogBody>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}
