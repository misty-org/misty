import { invoke } from "@tauri-apps/api/core";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import type { LocalToolHandler } from "../host";
import { loadRunEntry } from "../runContexts";
import { readRoute, refuse, writeRoute, writeSteps } from "./api";
import { integer, text } from "./args";
import { routedTool } from "./routing";
import { checkRevision, itemTools, madePath, object, objects, type MadeItem } from "./madeItems";

/**
 * Workbooks for agents (plan D6): sheets of cells where a formula starts with `=`, charts made
 * from ranges, and a dashboard of pinned charts. Reads come back computed; changes come back
 * with the errors they caused (`#REF!`, `#NAME?`), so the agent can fix a formula it broke.
 */

const OPS = [
  "set_range",
  "append_rows",
  "insert_rows",
  "delete_rows",
  "insert_cols",
  "delete_cols",
  "add_sheet",
  "rename_sheet",
  "delete_sheet",
  "add_chart",
  "update_chart",
  "delete_chart",
  "pin_to_dashboard",
] as const;
const MAX_SHEETS = 20;
const MAX_OPS = 200;

const workbookIdOf = (input: Record<string, unknown>) => {
  const id = text(input, "workbook_id", { max: 200 }).trim();
  if (!id) throw refuse("workbook_id is required");
  return id;
};

/** A sheet's rows: a list of lists of plain values. The model checks the cell limit. */
function rows(value: unknown, what: string): unknown[][] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((row) => !Array.isArray(row)))
    throw refuse(`${what} must be a list of rows, each a list of values`);
  for (const row of value as unknown[][])
    for (const cell of row)
      if (cell !== null && !["string", "number", "boolean"].includes(typeof cell))
        throw refuse(`${what} cells must be text, numbers, true/false or null`);
  return value as unknown[][];
}

const list = routedTool("read", async (request, space) => {
  const query = text(request.input, "query", { max: 500 }).trim().toLowerCase();
  const limit = integer(request.input, "limit", 1, 100) ?? 50;
  const { workbooks } = await readRoute<{ workbooks: MadeItem[] }>(
    request,
    madePath(space.id, "workbooks"),
  );
  const matches = workbooks
    .filter((workbook) => !query || workbook.title.toLowerCase().includes(query))
    .slice(0, limit)
    .map(({ id, title, updated_at, visibility }) => ({ id, title, updated_at, visibility }));
  return { workbooks: matches, count: matches.length };
});

const create = routedTool("create", async (request, space) => {
  const title = text(request.input, "title", { max: 200 }).trim();
  const sheets = objects(request.input.sheets, "sheets", MAX_SHEETS).map((sheet, index) => ({
    name: text(sheet, "name", { max: 100 }) || `Sheet ${index + 1}`,
    rows: rows(sheet.rows, `sheets[${index}].rows`),
  }));
  if (!sheets.length) throw refuse("a workbook needs at least one sheet");
  const charts = objects(request.input.charts, "charts", 50);
  return writeSteps(async () => {
    const workbook = await writeRoute<MadeItem>(request, madePath(space.id, "workbooks"), "POST", {
      title: title || "Untitled data",
    });
    const tools = await itemTools();
    const summary = await tools.edit("workbook", space.id, workbook.id, (doc) => {
      tools.createWorkbook(doc, { title: workbook.title, sheets, charts });
      return tools.readWorkbook(doc, {});
    });
    return { id: workbook.id, title: workbook.title, summary };
  });
});

const read = routedTool("read", async (request, space) => {
  const id = workbookIdOf(request.input);
  const workbook = await readRoute<MadeItem>(request, madePath(space.id, "workbooks", id));
  const args: Record<string, unknown> = {};
  const sheet = text(request.input, "sheet", { max: 100 });
  const range = text(request.input, "range", { max: 100 });
  if (sheet) args.sheet = sheet;
  if (range) args.range = range;
  const tools = await itemTools();
  const content = await tools.edit("workbook", space.id, id, (doc) =>
    tools.readWorkbook(doc, args),
  );
  return {
    id: workbook.id,
    title: workbook.title,
    revision: workbook.collaboration_revision,
    visibility: workbook.visibility,
    content,
  };
});

const apply = routedTool("change", async (request, space) => {
  const id = workbookIdOf(request.input);
  const ops = objects(request.input.ops, "ops", MAX_OPS);
  if (!ops.length) throw refuse("ops is required");
  for (const op of ops) {
    text(op, "op", { required: true, allowed: OPS });
    if (op.rows !== undefined) rows(op.rows, "rows");
    if (op.values !== undefined) rows(op.values, "values");
    if (op.chart !== undefined) object(op.chart, "chart");
  }
  const workbook = await readRoute<MadeItem>(request, madePath(space.id, "workbooks", id));
  checkRevision(workbook, request.input);
  return writeSteps(async () => {
    const tools = await itemTools();
    return tools.edit("workbook", space.id, id, (doc) => tools.applyWorkbookOps(doc, ops));
  });
});

/** Data too large to pass inline: a CSV or XLSX already in Media, or in the chat's folder. */
const importFile = routedTool("change", async (request, space) => {
  const id = workbookIdOf(request.input);
  const fileId = text(request.input, "file_id", { max: 200 }).trim();
  const path = text(request.input, "path", { max: 4000 }).trim();
  if (!fileId === !path) throw refuse("give file_id (a Media file) or path (in your folder), not both");
  let file: File;
  if (fileId) {
    const gateway = spacesGateway.maybe();
    if (!gateway) throw refuse("Media can't be reached from here.", "unavailable");
    file = await gateway.libraryFile(space.id, fileId);
  } else {
    const run = await loadRunEntry(request.runId).catch(() => null);
    if (!run?.conversationId)
      throw refuse("only a chat's agent has a folder to import from", "not_allowed");
    let bytes: ArrayBuffer;
    try {
      bytes = await invoke<ArrayBuffer>("chat_media_load", {
        account: run.account,
        conversation: run.conversationId,
        path,
      });
    } catch (error) {
      throw refuse(typeof error === "string" ? error : "that file can't be read");
    }
    file = new File([bytes], path.split(/[\\/]/).pop() || "data.csv");
  }
  if (!/\.(csv|tsv|xlsx)$/i.test(file.name)) throw refuse("import takes a .csv, .tsv or .xlsx file");
  return writeSteps(async () => {
    const tools = await itemTools();
    const summary = await tools.edit("workbook", space.id, id, (doc) =>
      tools.importWorkbookFile(doc, file),
    );
    return { imported: file.name, summary };
  });
});

export const workbookTools: Record<string, LocalToolHandler> = {
  "workbook.list": list,
  "workbook.create": create,
  "workbook.read": read,
  "workbook.apply": apply,
  "workbook.import": importFile,
};
