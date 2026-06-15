import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface OfficialAppNativeAccess {
  readonly folders: Set<string>;
  readonly files: Set<string>;
  readonly terminalSessions: Set<string>;
}

interface AppCommand {
  protocol?: number;
  appId?: string;
  requestId?: string;
  command?: string;
  payload?: Record<string, unknown>;
}

export function createOfficialAppNativeAccess(): OfficialAppNativeAccess {
  return { folders: new Set(), files: new Set(), terminalSessions: new Set() };
}

export async function respondToOfficialAppCommand(
  event: MessageEvent,
  appId: string,
  scopes: readonly string[],
  access: OfficialAppNativeAccess,
): Promise<void> {
  const request = event.data as AppCommand;
  if (
    request.protocol !== 1 ||
    request.appId !== appId ||
    typeof request.requestId !== "string" ||
    request.requestId.length === 0 ||
    request.requestId.length > 128 ||
    typeof request.command !== "string"
  )
    return;

  const respond = (ok: boolean, result?: unknown, error?: string) =>
    (event.source as WindowProxy | null)?.postMessage(
      {
        type: "misty:app-command-response",
        protocol: 1,
        appId,
        requestId: request.requestId,
        ok,
        result,
        error,
      },
      { targetOrigin: "*" },
    );

  try {
    const requiredScope = scopeForCommand(appId, request.command);
    if (!requiredScope || !scopes.includes(requiredScope)) {
      throw new Error("This app session does not grant that capability.");
    }
    const result = await runOfficialAppCommand(
      appId,
      request.command,
      request.payload ?? {},
      access,
    );
    respond(true, result);
  } catch (error) {
    respond(false, undefined, error instanceof Error ? error.message : String(error));
  }
}

export async function closeOfficialAppNativeAccess(
  appId: string,
  access: OfficialAppNativeAccess,
): Promise<void> {
  const sessions = [...access.terminalSessions];
  access.terminalSessions.clear();
  if (appId === "terminal") {
    await Promise.allSettled(sessions.map((sessionId) => invoke("terminal_kill", { sessionId })));
  }
}

async function runOfficialAppCommand(
  appId: string,
  command: string,
  payload: Record<string, unknown>,
  access: OfficialAppNativeAccess,
): Promise<unknown> {
  if (command === "host.pickFolder" && (appId === "files" || appId === "code")) {
    const selected = await open({
      directory: true,
      multiple: false,
      title:
        optionalString(payload.title, 80) ||
        (appId === "code" ? "Choose a project" : "Choose a folder"),
    });
    const path = typeof selected === "string" ? selected : "";
    const resolved = path ? await resolveGrantedPath(path, path, "directory") : "";
    if (resolved) access.folders.add(normalizePath(resolved));
    return { path: resolved };
  }

  if (command === "host.pickFiles" && appId === "files") {
    const selected = await open({
      directory: false,
      multiple: true,
      title: optionalString(payload.title, 80) || "Choose files",
    });
    const paths = selected == null ? [] : Array.isArray(selected) ? selected : [selected];
    const resolved = await Promise.all(paths.map((path) => resolveGrantedPath(path, path, "file")));
    resolved.forEach((path) => access.files.add(normalizePath(path)));
    return { paths: resolved };
  }

  if (appId === "files") return runFilesCommand(command, payload, access);
  if (appId === "code") return runCodeCommand(command, payload, access);
  if (appId === "terminal") return runTerminalCommand(command, payload, access);
  if (appId === "transfers") return runTransfersCommand(command, payload);
  if (appId === "browser") return runBrowserCommand(command, payload);
  throw new Error("This app does not have native host capabilities.");
}

async function runFilesCommand(
  command: string,
  payload: Record<string, unknown>,
  access: OfficialAppNativeAccess,
): Promise<unknown> {
  if (command === "files.listDirectory") {
    const path = await authorizedPath(payload.path, access, "directory");
    return invoke("explorer_list_directory", {
      request: { path, showHidden: false, forceRemoteRefresh: false },
    });
  }
  if (command === "files.openPath") {
    const filePath = await authorizedPath(payload.path, access, "any");
    await invoke("explorer_open_path", { filePath });
    return { ok: true };
  }
  throw new Error("Files did not recognize that operation.");
}

async function runCodeCommand(
  command: string,
  payload: Record<string, unknown>,
  access: OfficialAppNativeAccess,
): Promise<unknown> {
  if (command === "code.walkFiles") {
    const root = await authorizedPath(payload.root, access, "directory");
    return invoke("code_walk_files", { root });
  }
  if (command === "code.readFile") {
    return invoke("code_read_text_file", {
      path: await authorizedPath(payload.path, access, "file"),
    });
  }
  if (command === "code.writeFile") {
    const path = await authorizedPath(payload.path, access, "file");
    const contents = boundedString(payload.contents, 5 * 1024 * 1024, true);
    const lineEnding = payload.lineEnding === "crlf" ? "crlf" : "lf";
    return invoke("code_write_text_file", { path, contents, lineEnding });
  }
  throw new Error("Code did not recognize that operation.");
}

async function runTerminalCommand(
  command: string,
  payload: Record<string, unknown>,
  access: OfficialAppNativeAccess,
): Promise<unknown> {
  if (command === "terminal.create") {
    const requestedCwd = optionalString(payload.cwd, 4096);
    const cwd = requestedCwd ? await authorizedPath(requestedCwd, access, "directory") : null;
    const sessionId = await invoke<string>("terminal_create", {
      request: {
        cwd,
        cols: boundedInteger(payload.cols, 20, 400, 100),
        rows: boundedInteger(payload.rows, 2, 200, 30),
        pixelWidth: null,
        pixelHeight: null,
        env: {},
        environment: { kind: "local" },
      },
    });
    access.terminalSessions.add(sessionId);
    return { sessionId };
  }
  const sessionId = boundedString(payload.sessionId, 128);
  if (!sessionId || !access.terminalSessions.has(sessionId)) {
    throw new Error("That terminal session does not belong to this app window.");
  }
  if (command === "terminal.write") {
    await invoke("terminal_write", { sessionId, data: boundedString(payload.data, 65_536, true) });
    return { ok: true };
  }
  if (command === "terminal.resize") {
    await invoke("terminal_resize", {
      sessionId,
      cols: boundedInteger(payload.cols, 20, 400, 100),
      rows: boundedInteger(payload.rows, 2, 200, 30),
      pixelWidth: null,
      pixelHeight: null,
    });
    return { ok: true };
  }
  if (command === "terminal.interrupt") {
    await invoke("terminal_interrupt", { sessionId });
    return { ok: true };
  }
  if (command === "terminal.kill") {
    access.terminalSessions.delete(sessionId);
    await invoke("terminal_kill", { sessionId });
    return { ok: true };
  }
  throw new Error("Terminal did not recognize that operation.");
}

async function runTransfersCommand(
  command: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (command === "transfers.snapshot") return invoke("transfers_snapshot", { filter: {} });
  if (command === "transfers.retry") {
    return invoke("operation_queue_retry_transfer", {
      transferId: boundedInteger(payload.transferId, 1, Number.MAX_SAFE_INTEGER, 0),
    });
  }
  if (command === "transfers.dismiss") {
    await invoke("transfers_delete_selected", {
      ids: [boundedInteger(payload.transferId, 1, Number.MAX_SAFE_INTEGER, 0)],
    });
    return { ok: true };
  }
  throw new Error("Transfers did not recognize that operation.");
}

async function runBrowserCommand(
  command: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (command !== "browser.openExternal")
    throw new Error("Browser did not recognize that operation.");
  const raw = boundedString(payload.url, 4096);
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only web addresses can be opened.");
  }
  await openUrl(url.href);
  return { url: url.href };
}

async function authorizedPath(
  value: unknown,
  access: OfficialAppNativeAccess,
  expectedKind: "any" | "directory" | "file",
): Promise<string> {
  const raw = boundedString(value, 4096);
  if (!raw) throw new Error("Choose a folder or file first.");
  const path = normalizePath(raw);
  const folderRoot = [...access.folders].find(
    (root) => path === root || (root === "/" ? path.startsWith("/") : path.startsWith(root + "/")),
  );
  const fileRoot = access.files.has(path) ? path : "";
  const grantedRoot = folderRoot || fileRoot;
  if (!grantedRoot) throw new Error("That path has not been granted to this app window.");
  if (expectedKind === "directory" && fileRoot && !folderRoot)
    throw new Error("Choose a folder first.");
  return resolveGrantedPath(grantedRoot, path, expectedKind);
}

function normalizePath(path: string): string {
  if (path.includes("\0")) throw new Error("The app sent an invalid path.");
  const slashed = path.replace(/\\/g, "/");
  const drive = slashed.match(/^([a-z]):\//i)?.[1]?.toLowerCase();
  if (!drive && !slashed.startsWith("/")) throw new Error("The app sent a relative path.");
  const parts = slashed.slice(drive ? 3 : 1).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const normalized = (drive ? drive + ":/" : "/") + resolved.join("/");
  return normalized.length > (drive ? 3 : 1) ? normalized.replace(/\/+$/, "") : normalized;
}

async function resolveGrantedPath(
  root: string,
  candidate: string,
  expectedKind: "any" | "directory" | "file",
): Promise<string> {
  return invoke<string>("official_app_resolve_granted_path", {
    root,
    candidate,
    expectedKind,
  });
}

function scopeForCommand(appId: string, command: string): string | null {
  if (command === "host.pickFolder") return appId === "code" ? "code.read" : "files.read";
  if (command === "host.pickFiles") return "files.read";
  if (command === "files.listDirectory" || command === "files.openPath") return "files.read";
  if (command === "code.walkFiles" || command === "code.readFile") return "code.read";
  if (command === "code.writeFile") return "code.write";
  if (command.startsWith("terminal.")) return "terminal.execute";
  if (command === "transfers.snapshot") return "transfers.read";
  if (command === "transfers.retry" || command === "transfers.dismiss") return "transfers.write";
  if (command === "browser.openExternal") return "browser.navigate";
  return null;
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    if (allowEmpty && value === "") return "";
    throw new Error("The app sent invalid data.");
  }
  return value;
}

function optionalString(value: unknown, maximum: number): string {
  if (value == null || value === "") return "";
  return boundedString(value, maximum);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value == null && fallback >= minimum) return fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error("The app sent an invalid number.");
  }
  return Number(value);
}
