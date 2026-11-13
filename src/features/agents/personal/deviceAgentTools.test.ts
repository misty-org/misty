import "@/app/featureSeams";
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
const readSharedFile = vi.fn();
const uploadLibraryBlob = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("@/features/devices/api/native-devices", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  devicesNative: { readSharedFile: (...args: unknown[]) => readSharedFile(...args) },
}));
vi.mock("@/features/spaces/api/library-upload", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadLibraryBlob: (...args: unknown[]) => uploadLibraryBlob(...args),
}));
vi.mock("./useAgentsStore", () => ({
  agentsPrepareScopedDocument: vi.fn(async () => ({
    displayName: "q3.txt",
    mimeType: "text/plain",
    truncated: false,
    sections: [{ kind: "text", locator: "1", text: "Revenue grew" }],
  })),
}));

const { runDeviceAgentOperation } = await import("./deviceAgentTools");
const job = (operation: string, input: unknown, scopeId = "scope_reports", spaceId?: string) =>
  ({
    id: "j",
    runId: "r",
    nodeId: "n",
    scopeId,
    spaceId,
    operation,
    attempt: 1,
    input,
    config: {},
  }) as never;
const signal = new AbortController().signal;

beforeEach(() => vi.clearAllMocks());

it("keeps folder jobs inside the granted folder", async () => {
  invoke.mockResolvedValue({ entries: [] });
  await runDeviceAgentOperation(
    job("folder.list", { scopeId: "scope_reports", relativePath: "Q3" }),
    signal,
  );
  expect(invoke).toHaveBeenCalledWith("agents_list_scoped_files", {
    request: { scopeId: "scope_reports", relativePath: "Q3" },
  });
  await expect(
    runDeviceAgentOperation(
      job("folder.list", { scopeId: "scope_other", relativePath: "" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  await expect(
    runDeviceAgentOperation(
      job("folder.read", { scopeId: "scope_reports", relativePath: "../x" }),
      signal,
    ),
  ).rejects.toThrow("invalid_device_scope");
  expect(
    await runDeviceAgentOperation(
      job("folder.read", { scopeId: "scope_reports", relativePath: "q3.txt" }),
      signal,
    ),
  ).toMatchObject({ name: "q3.txt", text: "Revenue grew" });
});

it("sends a shared file to the conversation's Space Library", async () => {
  const input = { scopeId: "scope_reports", relativePath: "Q3/report.pdf" };
  readSharedFile.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  uploadLibraryBlob.mockResolvedValue({ item: { id: "item_1" } });
  expect(
    await runDeviceAgentOperation(job("folder.send", input, "scope_reports", "space_1"), signal),
  ).toEqual({ name: "report.pdf", size: 3, libraryItemId: "item_1" });
  expect(readSharedFile).toHaveBeenCalledWith("scope_reports", input, {});
  expect(uploadLibraryBlob).toHaveBeenCalledWith("space_1", expect.any(Blob), "report.pdf");
});

it("needs a Space to send a file to", async () => {
  await expect(
    runDeviceAgentOperation(
      job("folder.send", { scopeId: "scope_reports", relativePath: "report.pdf" }),
      signal,
    ),
  ).rejects.toThrow("no_space");
  expect(readSharedFile).not.toHaveBeenCalled();
});
