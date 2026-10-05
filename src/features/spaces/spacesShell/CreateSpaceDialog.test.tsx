import type * as ReactRouterDom from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateSpaceDialog } from "./CreateSpaceDialog";
import { useCreateSpaceDialog } from "./useCreateSpaceDialog";

const mocks = vi.hoisted(() => ({
  people: vi.fn(),
  invite: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: { people: mocks.people, invite: mocks.invite },
}));
vi.mock("react-router-dom", async (load) => ({
  ...(await load<typeof ReactRouterDom>()),
  useNavigate: () => mocks.navigate,
}));

const createSpace = vi.fn(async () => ({ space: { id: "space-new" } }));

function Harness() {
  const dialog = useCreateSpaceDialog({
    createSpace: createSpace as never,
    clearError: () => undefined,
  });
  return (
    <>
      <button type="button" onClick={dialog.start}>
        Open
      </button>
      <CreateSpaceDialog dialog={dialog} />
    </>
  );
}

function open() {
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}

describe("Create a Space", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.people.mockResolvedValue({
      people: [{ user_id: "sam", name: "Sam Lee", email: "Sam@studio.dev" }],
    });
    mocks.invite.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("creates an empty Space even when people can't load", async () => {
    mocks.people.mockRejectedValue(new Error("offline"));
    open();
    fireEvent.change(screen.getByPlaceholderText("Design team"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    await waitFor(() => expect(createSpace).toHaveBeenCalledWith({ name: "Ops" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/space-new/chat");
  });

  it("invites picked people once the Space exists", async () => {
    open();
    fireEvent.change(screen.getByPlaceholderText("Design team"), { target: { value: "Studio" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sam/ }));
    const email = screen.getByLabelText("Add by email");
    fireEvent.change(email, { target: { value: "dana@studio.dev" } });
    fireEvent.keyDown(email, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove dana@studio.dev" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledTimes(2));
    expect(createSpace).toHaveBeenCalledWith({ name: "Studio" });
    expect(mocks.invite).toHaveBeenCalledWith("space-new", "sam@studio.dev");
    expect(mocks.invite).toHaveBeenCalledWith("space-new", "dana@studio.dev");
  });
});
