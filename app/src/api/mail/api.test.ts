import { apiRequest } from "@/api/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mailApi } from "./api";

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }));

describe("mail API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("encodes thread list filters", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ threads: [] });
    await mailApi.threads({
      connectionId: "connection one",
      folderId: "INBOX",
      query: "from:alex@example.com",
      pageToken: "next page",
      pageSize: 25,
    });
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toContain("connection_id=connection+one");
    expect(vi.mocked(apiRequest).mock.calls[0]?.[0]).toContain("page_token=next+page");
  });

  it("always marks an explicit user-confirmed send", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ message: {} });
    await mailApi.sendDraft("draft-1", "connection-1");
    expect(apiRequest).toHaveBeenCalledWith("/mail/drafts/draft-1/send", {
      method: "POST",
      body: JSON.stringify({
        connection_id: "connection-1",
        authoring_source: "user",
        confirmed: true,
      }),
    });
  });
});
