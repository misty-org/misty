import type { SQLNamespace } from "@codemirror/lang-sql";
import type { CellValue, DbKind, DbSchema, TableRef } from "./dbApi";

/** Rows a query brings back unless it says otherwise. */
export const ROW_LIMIT = 500;

/** A name in double quotes, the same in SQLite and Postgres. */
export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The schema a table lives in when a query names it bare. */
export const defaultSchema = (kind: DbKind) => (kind === "postgres" ? "public" : "main");

export function tableName(table: TableRef) {
  return `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
}

/** What opening a table runs. */
export function selectTable(table: TableRef) {
  return `select * from ${tableName(table)} limit ${ROW_LIMIT}`;
}

/** A cell's value as text, for the grid and the edit field. */
export function cellText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** A value as a SQL literal, for showing the UPDATE Misty will run. Native code binds the real
 * values as parameters; this is only their written form. */
function literal(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${cellText(value).replace(/'/g, "''")}'`;
}

/** The statement one row's changes become, as the confirm dialog shows it. */
export function updateStatement(
  table: TableRef,
  key: Record<string, CellValue>,
  changes: Record<string, CellValue>,
) {
  const sets = Object.entries(changes).map(
    ([name, value]) => `${quoteIdent(name)} = ${literal(value)}`,
  );
  const wheres = Object.entries(key).map(
    ([name, value]) => `${quoteIdent(name)} = ${literal(value)}`,
  );
  return `update ${tableName(table)}\n   set ${sets.join(",\n       ")}\n where ${wheres.join("\n   and ")};`;
}

/** The schema as CodeMirror's SQL completion reads it: schema, then table, then its columns. */
export function completionSchema(schema: DbSchema): SQLNamespace {
  const namespace: Record<string, Record<string, SQLNamespace>> = {};
  for (const group of schema.schemas) {
    const tables: Record<string, SQLNamespace> = {};
    for (const table of group.tables) {
      tables[table.name] = {
        self: { label: table.name, type: table.kind === "view" ? "type" : "class" },
        children: table.columns.map((column) => ({
          label: column.name,
          type: "property",
          detail: column.type,
        })),
      };
    }
    namespace[group.name] = tables;
  }
  return namespace;
}
