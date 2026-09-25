import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createMistyAppSDK } from "@misty/sdk";
import { expect, it, vi } from "vitest";
import { createSdkNotesRuntime } from "./sdkNotesRuntime";
import { SpaceNotesView } from "./SpaceNotesView";

it("runs the existing Notes view with only SDK services, creates a note and opens one shared Yjs lease", async () => {
  const note = {
    id: "note-a",
    space_id: "space-a",
    creator_user_id: "account-a",
    title: "Saved SDK note",
    markdown: "Existing text",
    plain_text: "Existing text",
    lifecycle_state: "active",
    collaboration_revision: 0,
    acl_version: 1,
    audience_kind: "space",
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
    role: "creator",
    can_delete: true,
    backlink_count: 0,
  };
  const notes = [note];
  const subscriptions = new Map<string, (event: unknown) => void>();
  const request = vi.fn(async (message: { method: string; params?: unknown }): Promise<unknown> => {
    if (message.method === "notes.list") return { notes };
    if (message.method === "notes.create") {
      const created = {
        ...note,
        id: "note-b",
        title: (message.params as { body: { title: string } }).body.title,
        markdown: "",
        plain_text: "",
      };
      notes.push(created);
      return created;
    }
    if (message.method === "collaboration.open")
      return { handle: crypto.randomUUID(), role: "creator" };
    if (message.method === "ai.snapshot") return { available: false, following: false };
    return undefined;
  });
  const registerSurface = vi.fn(async () => () => {});
  const misty = createMistyAppSDK({
    request,
    registerSurface,
    subscribe: async (topic, listener) => {
      subscriptions.set(topic, listener);
      return () => {
        subscriptions.delete(topic);
      };
    },
  });
  const abort = new AbortController(),
    report = vi.fn();
  const instance = await createSdkNotesRuntime({
    misty,
    spaceId: "space-a",
    userId: "account-a",
    members: [],
    signal: abort.signal,
    report,
  });
  const view = render(
    <MemoryRouter initialEntries={["/spaces/space-a/notes?view=list"]}>
      <SpaceNotesView spaceId="space-a" spaceName="Product" runtime={instance.runtime} />
    </MemoryRouter>,
  );
  try {
    await screen.findAllByText("Saved SDK note");
    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    const input = document.querySelector<HTMLInputElement>("#new-note-title")!;
    fireEvent.change(input, { target: { value: "Created through SDK" } });
    fireEvent.click(screen.getByRole("button", { name: "Create note" }));
    await waitFor(() =>
      expect(
        instance.store.getState().notes.some((note) => note.title === "Created through SDK"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Note title") as HTMLInputElement).value).toBe(
        "Created through SDK",
      ),
    );
    await waitFor(() => expect(registerSurface).toHaveBeenCalled());
    expect(
      request.mock.calls.filter(([message]) => message.method === "collaboration.open"),
    ).toHaveLength(1);
    expect(request).toHaveBeenCalledWith({
      method: "notes.create",
      params: { body: { title: "Created through SDK" } },
    });
    expect(view.container.querySelector("iframe")).toBeNull();
    expect(report).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    act(() => {
      abort.abort();
      instance.close();
    });
  }
  await waitFor(() => expect(subscriptions.size).toBe(0));
  expect(request.mock.calls.some(([message]) => message.method === "collaboration.close")).toBe(
    true,
  );
});
