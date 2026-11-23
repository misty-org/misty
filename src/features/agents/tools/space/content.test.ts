import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spacesGateway } from "../../spaces-gateway/spaces_gateway";
import { spaceTools } from "../space_tools";
import { SPACES, call, serve } from "./test_routes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
vi.mock("../run_contexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

const entry = (path: string, kind: "file" | "folder" = "file") => ({
  id: `drv_${path}`,
  space_id: "s1",
  path,
  name: path.split("/").pop() ?? "",
  kind,
  size: 4,
  mtime_ms: 0,
  modified_by_name: "Ana",
});

const drive = vi.hoisted(() => ({
  driveList: vi.fn(),
  driveEntry: vi.fn(),
  driveRead: vi.fn(),
  driveReplace: vi.fn(),
  saveToDrive: vi.fn(),
  attachmentContent: vi.fn(),
}));
spacesGateway.provide(drive as never);

describe("files", () => {
  it("searches the Space's Files by name, folder by folder", async () => {
    serve(SPACES);
    drive.driveList.mockImplementation(async (_space: string, folder: string) => ({
      entries:
        folder === "/"
          ? [entry("/Tax", "folder"), entry("/notes.md")]
          : [entry("/Tax/tax form.pdf")],
    }));
    await expect(
      call(tool("file.search"), { space: "s1", query: "tax form", limit: 99 }),
    ).resolves.toMatchObject({ files: [{ path: "/Tax/tax form.pdf" }], count: 1 });
  });

  it("reads a file's facts, and a text file's text", async () => {
    serve(SPACES);
    drive.driveEntry.mockResolvedValue(entry("/notes.md"));
    drive.driveRead.mockResolvedValue(new TextEncoder().encode("hi").buffer);
    await expect(call(tool("file.read"), { space: "s1", path: "notes.md" })).resolves.toMatchObject(
      {
        path: "/notes.md",
        text: "hi",
      },
    );
    expect(drive.driveEntry).toHaveBeenCalledWith("s1", "/notes.md");
    await expect(
      call(tool("file.read"), { space: "s1", path: "../x" }).catch(refusal),
    ).resolves.toMatch(/path in the Space's Files/);
  });

  it("writes new text into a file at the version it has now", async () => {
    serve(SPACES);
    const current = { ...entry("/a.md"), version: 7 };
    drive.driveEntry.mockResolvedValue(current);
    drive.driveReplace.mockResolvedValue(current);
    await call(tool("file.update"), { space: "s1", path: "/a.md", content: "new" });
    expect(drive.driveReplace).toHaveBeenCalledWith("s1", current, expect.any(Blob));
  });

  it("saves an attachment into the Space's Files", async () => {
    serve(SPACES);
    drive.attachmentContent.mockResolvedValue(new Blob(["x"]));
    drive.saveToDrive.mockResolvedValue(entry("/Inbox/a.pdf"));
    await expect(
      call(tool("file.promote_attachment"), {
        space: "s1",
        attachmentId: "a",
        name: "a.pdf",
        folder: "Inbox",
      }),
    ).resolves.toMatchObject({ path: "/Inbox/a.pdf" });
    expect(drive.saveToDrive).toHaveBeenCalledWith("s1", "/Inbox", "a.pdf", expect.any(Blob));
    await expect(
      call(tool("file.promote_attachment"), { space: "s1" }).catch(refusal),
    ).resolves.toBe("attachment id is required");
  });
});
