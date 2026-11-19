import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

export type DbKind = "sqlite" | "postgres";
export type SslMode = "disable" | "prefer" | "require";

export interface SqliteTarget {
  path: string;
}

export interface PostgresTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: SslMode;
}

/** A connection as the dialog edits it. An empty id saves a new one. */
export interface DbConnection {
  id: string;
  name: string;
  kind: DbKind;
  sqlite?: SqliteTarget | null;
  postgres?: PostgresTarget | null;
}

/** A saved connection. The password itself never leaves native code. */
export interface SavedConnection extends DbConnection {
  hasPassword: boolean;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface SchemaTable {
  name: string;
  kind: "table" | "view";
  columns: SchemaColumn[];
}

export interface SchemaGroup {
  /** A Postgres schema, or an attached SQLite database (`main` first). */
  name: string;
  tables: SchemaTable[];
}

export interface DbSchema {
  schemas: SchemaGroup[];
}

/** A value as native code hands it over: bytes as `\x` hex, big numbers as text, times as ISO. */
export type CellValue =
  string | number | boolean | null | CellValue[] | { [key: string]: CellValue };

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: CellValue[][];
  rowsAffected: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface TableRef {
  schema: string;
  name: string;
}

const account = () => agentAccountId();

/** The Code page's database calls (`src-tauri/features/code/db`). */
export const dbApi = {
  list: () => invoke<SavedConnection[]>("code_db_list", { account: account() }),
  /** `password` replaces the saved one, "" removes it, and leaving it out keeps it. */
  save: (connection: DbConnection, password?: string) =>
    invoke<SavedConnection>("code_db_save", { account: account(), connection, password }),
  remove: (id: string) => invoke<void>("code_db_remove", { account: account(), id }),
  test: (connection: DbConnection, password?: string) =>
    invoke<void>("code_db_test", { account: account(), connection, password }),
  /** The system's file dialog; null when the person cancels. */
  pickSqlite: () => invoke<string | null>("code_db_pick_sqlite", { account: account() }),
  schema: (id: string) => invoke<DbSchema>("code_db_schema", { account: account(), id }),
  query: (id: string, sql: string, limit: number, queryId: string) =>
    invoke<QueryResult>("code_db_query", { account: account(), id, sql, limit, queryId }),
  cancel: (queryId: string) => invoke<void>("code_db_cancel", { account: account(), queryId }),
  updateRow: (
    id: string,
    table: TableRef,
    key: Record<string, CellValue>,
    changes: Record<string, CellValue>,
  ) => invoke<void>("code_db_update_row", { account: account(), id, table, key, changes }),
};

export const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
