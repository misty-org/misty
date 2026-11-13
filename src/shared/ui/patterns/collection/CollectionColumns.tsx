import { createContext, useContext, useMemo, useState, type ComponentProps } from "react";
import { RotateCcw, TableProperties } from "lucide-react";
import { IconButton } from "../../controls/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../overlays/DropdownMenu";
import { MenuCheckItem, MenuItem, MenuLabel, MenuSeparator } from "../../overlays/MenuItem";
import { cn } from "../../classNames";
import { collectionMemory } from "./collectionMemory";

type ColumnSchema = {
  id: string;
  columns: { key: string; label: string }[];
  /** The `misty.db` key its hidden columns are kept under; without one they last for the page. */
  remember?: string;
};
export const CollectionColumnsContext = createContext<{
  schema: ColumnSchema | null;
  register: (schema: ColumnSchema | null) => void;
  hidden: Record<string, string[]>;
  setHidden: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
} | null>(null);

export function CollectionPage({ className, ...props }: ComponentProps<"div">) {
  const [schema, register] = useState<ColumnSchema | null>(null);
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const value = useMemo(() => ({ schema, register, hidden, setHidden }), [schema, hidden]);
  return (
    <CollectionColumnsContext.Provider value={value}>
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-charcoal-workspace",
          "px-4 pb-5 text-cream",
          className,
        )}
        {...props}
      />
    </CollectionColumnsContext.Provider>
  );
}

const noColumns: string[] = [];

/** One table's hidden columns, from `misty.db` when it has a `remember` key, else from its page. */
export function useHiddenColumns(schemaId: string, remember?: string) {
  const context = useContext(CollectionColumnsContext);
  const saved = collectionMemory.useEntry(remember)?.hidden;
  const hidden = (remember ? saved : context?.hidden[schemaId]) ?? noColumns;
  const setHidden = (change: (current: string[]) => string[]) => {
    if (remember)
      collectionMemory.set(remember, (entry) => ({
        ...entry,
        hidden: change(entry?.hidden ?? []),
      }));
    else
      context?.setHidden((current) => ({
        ...current,
        [schemaId]: change(current[schemaId] ?? []),
      }));
  };
  return [hidden, setHidden] as const;
}

export function CollectionColumnChooser() {
  const context = useContext(CollectionColumnsContext);
  const [excluded, setExcluded] = useHiddenColumns(
    context?.schema?.id ?? "",
    context?.schema?.remember,
  );
  if (!context?.schema) return null;
  const { schema } = context;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Choose columns">
          <TableProperties />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <MenuLabel>Columns</MenuLabel>
        {schema.columns.map((column) => (
          <MenuCheckItem
            key={column.key}
            label={column.label}
            checked={!excluded.includes(column.key)}
            // The name says which row is which, so it can't be hidden.
            disabled={column.key === "name"}
            onCheckedChange={(checked) =>
              setExcluded((current) =>
                checked ? current.filter((key) => key !== column.key) : [...current, column.key],
              )
            }
          />
        ))}
        <MenuSeparator />
        <MenuItem
          icon={RotateCcw}
          label="Reset columns"
          disabled={!excluded.length}
          onSelect={() => setExcluded(() => [])}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
