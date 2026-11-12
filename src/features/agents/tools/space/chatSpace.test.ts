import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { runSpaceId } from "../runContexts";
import { spaceTools } from "../spaceTools";
import { SPACES, call, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
vi.mock("../runContexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => ""),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runSpaceId).mockResolvedValue("s1");
});

describe("a chat's run", () => {
  it("reads only its chat's Space", async () => {
    const calls = serve({ ...SPACES, "GET /spaces/s1/drawings": { drawings: [] } });
    await expect(call(tool("drawing.list"), {})).resolves.toEqual({ drawings: [], count: 0 });
    expect(calls.map((request) => request.path)).not.toContain("/spaces/s0/drawings");
  });

  it("creates and changes in its chat's Space without naming it", async () => {
    const calls = serve({ ...SPACES, "POST /spaces/s1/drawings": { id: "d" } });
    await call(tool("drawing.create"), { title: "New" });
    expect(calls[1]).toMatchObject({ path: "/spaces/s1/drawings", body: { title: "New" } });
  });

  it("is refused another Space", async () => {
    serve(SPACES);
    await expect(call(tool("drawing.list"), { space: "Home" }).catch(refusal)).resolves.toBe(
      'this chat works only in "Work" (s1)',
    );
  });

  it("searches only its chat's Space", async () => {
    const calls = serve({ ...SPACES, "GET /search?q=plan&limit=20&space_id=s1": { results: [] } });
    await call(tool("search.all"), { query: "plan" });
    expect(calls[calls.length - 1]?.path).toBe("/search?q=plan&limit=20&space_id=s1");
  });

  it("is refused everything once its chat's Space is gone", async () => {
    vi.mocked(runSpaceId).mockResolvedValue("gone");
    serve(SPACES);
    await expect(call(tool("drawing.list"), {}).catch(refusal)).resolves.toBe(
      "this chat's Space is no longer yours; move the chat to another Space",
    );
  });
});
