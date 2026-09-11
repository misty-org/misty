export type DiscoverSortField = "name" | "publisher" | "category" | "size" | "added";
export type DiscoverSort = "catalog" | `${DiscoverSortField}-${"asc" | "desc"}`;
export type SortValues = {
  name: string;
  publisher?: string;
  category?: string;
  size?: number;
  added?: number;
};
export const discoverSortOptions: { field: DiscoverSortField; label: string }[] = [
  { field: "name", label: "Name" },
  { field: "publisher", label: "Publisher" },
  { field: "category", label: "Category" },
  { field: "size", label: "Download size" },
  { field: "added", label: "Date added to Space" },
];
export function nextDiscoverSort(current: DiscoverSort, field: DiscoverSortField): DiscoverSort {
  return current === `${field}-asc`
    ? `${field}-desc`
    : current === `${field}-desc`
      ? "catalog"
      : `${field}-asc`;
}
export function compareDiscoverItems(a: SortValues, b: SortValues, sort: DiscoverSort) {
  if (sort === "catalog") return 0;
  const field = sort.split("-")[0] as DiscoverSortField;
  const left = a[field],
    right = b[field];
  const missing = (value: string | number | undefined) =>
    value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  if (missing(left) || missing(right))
    return missing(left) === missing(right) ? a.name.localeCompare(b.name) : missing(left) ? 1 : -1;
  const order =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: "base",
        });
  return order * (sort.endsWith("-asc") ? 1 : -1) || a.name.localeCompare(b.name);
}
