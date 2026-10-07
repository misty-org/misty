import { createContext, useContext, useMemo, useState, type ComponentProps } from "react";
import { TableProperties } from "lucide-react";
import { IconButton } from "../../controls/IconButton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../overlays/DropdownMenu";
import { cn } from "../../utils";

export type ColumnSchema = { id: string; columns: { key: string; label: string }[] };
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
          "px-4 pt-3 pb-5 sm:px-6 text-cream misty-transient-scrollbar",
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
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        {schema.columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={!excluded.includes(column.key)}
            disabled={column.key === "name"}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              setHidden((current) => ({
                ...current,
                [schema.id]: checked
                  ? (current[schema.id] ?? []).filter((key) => key !== column.key)
                  : [...(current[schema.id] ?? []), column.key],
              }))
            }
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!excluded.length}
          onSelect={() => setHidden((current) => ({ ...current, [schema.id]: [] }))}
        >
          Reset columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
