import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Input,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  Text,
} from "@/shared/ui";

/**
 * A column's filter: the values it shows, each with a check; unchecking one hides its rows. Only
 * this person's view is filtered, never anyone else's.
 */
export function FilterPopover(props: {
  column: string;
  values: readonly string[];
  capped: boolean;
  /** The values shown now; null when the column isn't filtered. */
  allowed: ReadonlySet<string> | null;
  onChange(allowed: ReadonlySet<string> | null): void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? props.values.filter((value) => value.toLowerCase().includes(q)) : props.values;
  }, [props.values, query]);
  const isShown = (value: string) => !props.allowed || props.allowed.has(value);
  const toggle = (value: string, on: boolean) => {
    const next = new Set(props.allowed ?? props.values);
    if (on) next.add(value);
    else next.delete(value);
    props.onChange(
      next.size === props.values.length && props.values.every((item) => next.has(item))
        ? null
        : next,
    );
  };
  return (
    <PopoverContent size="md" align="start">
      <PopoverHeader title={`Filter column ${props.column}`} />
      <PopoverBody>
        <Input
          value={query}
          placeholder="Search values"
          aria-label="Search values"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="grid max-h-64 gap-1 overflow-y-auto" role="group" aria-label="Values">
          {shown.length ? (
            shown.map((value) => (
              <label key={value} className="flex h-7 min-w-0 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={isShown(value)}
                  onCheckedChange={(checked) => toggle(value, checked === true)}
                />
                <Text size="control" className="min-w-0 flex-1">
                  {value === "" ? "(Blank)" : value}
                </Text>
              </label>
            ))
          ) : (
            <Text size="control" tone="muted">
              No values match.
            </Text>
          )}
          {props.capped ? (
            <Text size="caption" tone="muted" wrap>
              Showing the first {props.values.length} values.
            </Text>
          ) : null}
        </div>
      </PopoverBody>
      <PopoverActions>
        <Button
          variant="quiet"
          size="md"
          disabled={!props.allowed}
          onClick={() => props.onChange(null)}
        >
          Show all
        </Button>
        <Button variant="secondary" size="md" onClick={() => props.onChange(new Set())}>
          Hide all
        </Button>
      </PopoverActions>
    </PopoverContent>
  );
}
