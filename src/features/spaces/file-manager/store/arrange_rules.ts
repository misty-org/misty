export interface FilesSort {
  key: "name" | "modified" | "size" | "kind";
  descending: boolean;
}

export interface ArrangeRow {
  name: string;
  lower: string;
  folder: boolean;
  size: number | undefined;
  modified: number;
  kind: string;
}

export interface ArrangeAsk {
  needle: string;
  sort: FilesSort | undefined;
  finder: boolean;
}

export const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const missing = (value: number | string | undefined) =>
  value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));

function compareValues(
  a: number | string | undefined,
  b: number | string | undefined,
  descending: boolean,
) {
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const result =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : nameCollator.compare(String(a), String(b));
  return descending ? -result : result;
}

export function arrangeOrder(rows: ArrangeRow[], ask: ArrangeAsk): number[] {
  const order: number[] = [];
  for (let index = 0; index < rows.length; index += 1)
    if (!ask.needle || rows[index].lower.includes(ask.needle)) order.push(index);
  const sort = ask.sort;
  if (sort) {
    const value = (row: ArrangeRow) =>
      sort.key === "name"
        ? row.name
        : sort.key === "modified"
          ? row.modified
          : sort.key === "size"
            ? row.size
            : row.kind;
    order.sort((a, b) => compareValues(value(rows[a]), value(rows[b]), sort.descending) || a - b);
  } else if (ask.finder)
    order.sort((a, b) => {
      const left = rows[a];
      const right = rows[b];
      if (left.folder !== right.folder) return left.folder ? -1 : 1;
      return nameCollator.compare(left.name, right.name) || a - b;
    });
  return order;
}
