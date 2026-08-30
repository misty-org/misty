import { figmaDrawingsApi, type FigmaBindingContext } from "@/api/integrations/figma";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FigmaBindingCard } from "./FigmaBindingCard";
import { contextKey, useFigmaDrawingsStore } from "./useFigmaDrawingsStore";

vi.mock("@/api/integrations/figma", () => ({
  figmaFileUrl: (key: string) => `https://www.figma.com/file/${key}`,
  figmaDrawingsApi: {
    comment: vi.fn(),
    context: vi.fn(),
    sync: vi.fn(),
    records: vi.fn(),
    reconcileWebhooks: vi.fn(),
    unbind: vi.fn(),
  },
}));
vi.mock("@/shared/platform/openExternalLink", () => ({ openExternalLink: vi.fn() }));

describe("FigmaBindingCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFigmaDrawingsStore.getState().reset();
    useFigmaDrawingsStore.setState({
      accounts: [
        {
          id: "connection-1",
          provider: "figma",
          account_display: "Designer",
          status: "active",
          capabilities: ["drawings_read", "drawings_comments", "drawings_webhooks"],
        },
      ],
      bindings: [binding],
      contextByBinding: { [contextKey(binding.id)]: context },
    });
    vi.mocked(figmaDrawingsApi.context).mockResolvedValue(context);
  });
  afterEach(cleanup);

  it("shows provenance and preserves one idempotency key across a failed explicit retry", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
    vi.mocked(figmaDrawingsApi.comment)
      .mockRejectedValueOnce(new Error("network interrupted"))
      .mockResolvedValueOnce({ comment: context.comments[0] });

    render(<FigmaBindingCard spaceId="space-1" binding={binding} canManage />);
    expect(screen.getByText(/Source: Figma/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Figma comment" }), {
      target: { value: "Ship this screen" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Figma node ID (optional)" }), {
      target: { value: "12:34" },
    });
    expect(figmaDrawingsApi.comment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review comment" }));
    expect(await screen.findByText(/File: Launch System/)).toBeTruthy();
    expect(screen.getByText(/Node: 12:34/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Post to Figma" }));
    await waitFor(() => expect(figmaDrawingsApi.comment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Post to Figma" }));
    await waitFor(() => expect(figmaDrawingsApi.comment).toHaveBeenCalledTimes(2));

    const first = vi.mocked(figmaDrawingsApi.comment).mock.calls[0][2];
    const retry = vi.mocked(figmaDrawingsApi.comment).mock.calls[1][2];
    expect(first).toEqual(
      expect.objectContaining({
        confirmed: true,
        message: "Ship this screen",
        node_id: "12:34",
        idempotency_key: "00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(retry.idempotency_key).toBe(first.idempotency_key);
  });

  it("lets readers view linked context without rendering mutation controls", () => {
    render(<FigmaBindingCard spaceId="space-1" binding={binding} canManage={false} />);

    expect(screen.getAllByText("Launch System")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Review comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

const binding = {
  id: "binding-1",
  space_id: "space-1",
  connection_id: "connection-1",
  integration_id: "integration-1",
  shared_resource_id: "resource-1",
  bound_by_user_id: "user-1",
  resource_type: "file",
  external_id: "Abc_def-123",
  display_name: "Launch System",
  file_key: "Abc_def-123",
  status: "active",
  created_at: "2026-08-19T00:00:00Z",
  updated_at: "2026-08-19T00:00:00Z",
} as const;

const context: FigmaBindingContext = {
  file: {
    key: "Abc_def-123",
    name: "Launch System",
    version: "42",
    last_modified: "2026-08-19T00:00:00Z",
    editor_type: "figma",
  },
  versions: [],
  comments: [{ id: "comment-1", message: "Ready", created_at: "2026-08-19T00:00:00Z" }],
};
