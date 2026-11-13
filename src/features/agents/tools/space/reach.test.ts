import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalToolRejected } from "../host";
import { spaceTools } from "../spaceTools";
import { SPACES, call, serve } from "./testRoutes";

vi.mock("@/api/client", async (original) => ({
  ...(await original<object>()),
  apiRequest: vi.fn(),
}));
// The run works in its agent's home Space, Work.
vi.mock("../runContexts", async (original) => ({
  ...(await original<object>()),
  runSpaceId: vi.fn(async () => "s1"),
}));

const tool = (name: string) => spaceTools[name];
const refusal = (error: unknown) => (error as LocalToolRejected).message;

beforeEach(() => vi.clearAllMocks());

describe("search.all", () => {
  it("asks only in the run's home Space, named or not", async () => {
    const answer = { results: [{ kind: "note", id: "n" }] };
    const calls = serve({
      ...SPACES,
      "GET /search?q=q3+budget&limit=20&space_id=s1": answer,
      "GET /search?q=q3&limit=5&kinds=note%2Cmessage&space_id=s1": answer,
    });
    await expect(call(tool("search.all"), { query: " q3 budget " })).resolves.toEqual(answer);
    expect(calls.map((request) => request.path)).toEqual([
      "/spaces",
      "/search?q=q3+budget&limit=20&space_id=s1",
    ]);
    await expect(
      call(tool("search.all"), {
        query: "q3",
        limit: 5,
        space: "Work",
        kinds: ["note", "message"],
      }),
    ).resolves.toEqual(answer);
  });

  it("needs words", async () => {
    serve(SPACES);
    await expect(call(tool("search.all"), { query: " " }).catch(refusal)).resolves.toBe(
      "The arguments do not match this tool's input schema.",
    );
  });
});
