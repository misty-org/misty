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

type ColumnSchema = { id: string; columns: { key: string; label: string }[] };
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

export function CollectionColumnChooser() {
  const context = useContext(CollectionColumnsContext);
  if (!context?.schema) return null;
  const { schema, hidden, setHidden } = context;
  const excluded = hidden[schema.id] ?? [];
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
              setHidden((current) => ({
                ...current,
                [schema.id]: checked
                  ? (current[schema.id] ?? []).filter((key) => key !== column.key)
                  : [...(current[schema.id] ?? []), column.key],
              }))
            }
          />
        ))}
        <MenuSeparator />
        <MenuItem
          icon={RotateCcw}
          label="Reset columns"
          disabled={!excluded.length}
          onSelect={() => setHidden((current) => ({ ...current, [schema.id]: [] }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
