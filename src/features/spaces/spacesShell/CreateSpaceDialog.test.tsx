import type * as ReactRouterDom from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceTemplate } from "@/api/spaces/dto/interfaces/types";
import { CreateSpaceDialog } from "./CreateSpaceDialog";
import { useCreateSpaceDialog } from "./useCreateSpaceDialog";

const mocks = vi.hoisted(() => ({
  templates: vi.fn(),
  personal: vi.fn(),
  people: vi.fn(),
  invite: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: { templates: mocks.templates, invite: mocks.invite },
}));
vi.mock("@/api/spaces/templates", () => ({
  personalSpaceTemplatesApi: { list: mocks.personal, people: mocks.people },
}));
vi.mock("react-router-dom", async (load) => ({
  ...(await load<typeof ReactRouterDom>()),
  useNavigate: () => mocks.navigate,
}));

const startup: SpaceTemplate = {
  id: "startup",
  name: "Startup",
  description: "Keep an early team aligned.",
  version: 1,
  icon: "rocket",
  suggested_name: "Startup",
  seed_summary: { task_count: 1, note_count: 1, collection_count: 1 },
  seed_preview: {
    tasks: ["Talk to a first user"],
    notes: ["Company snapshot"],
    collections: ["Product"],
  },
};

const createSpace = vi.fn(async () => ({
  space: { id: "space-new" },
  setup: { selected_providers: [], completed_providers: [], pending_providers: [] },
}));

function Harness() {
  const dialog = useCreateSpaceDialog({
    createSpace: createSpace as never,
    clearError: () => undefined,
    spaces: [],
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
    mocks.personal.mockResolvedValue({ templates: [] });
    mocks.people.mockResolvedValue({
      people: [{ user_id: "sam", name: "Sam Lee", email: "Sam@studio.dev" }],
    });
    mocks.invite.mockResolvedValue({});
  });
  afterEach(cleanup);

  it("still creates a Blank Space when templates can't load", async () => {
    mocks.templates.mockRejectedValue(new Error("offline"));
    open();
    await screen.findByText(/Templates couldn't load/);
    expect(screen.getByRole("radio", { name: /Blank/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByPlaceholderText("Design team"), { target: { value: "Ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    await waitFor(() =>
      expect(createSpace).toHaveBeenCalledWith({
        name: "Ops",
        template_id: "blank",
        integration_providers: [],
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/spaces/space-new/home");
  });

  it("names the Space after the template and invites picked people once it exists", async () => {
    mocks.templates.mockResolvedValue({ templates: [startup] });
    open();
    fireEvent.click(await screen.findByRole("radio", { name: /Startup/ }));
    expect((screen.getByPlaceholderText("Design team") as HTMLInputElement).value).toBe("Startup");
    expect(screen.getByText("Talk to a first user")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Sam/ }));
    const email = screen.getByLabelText("Add by email");
    fireEvent.change(email, { target: { value: "dana@studio.dev" } });
    fireEvent.keyDown(email, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove dana@studio.dev" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
    await waitFor(() => expect(mocks.invite).toHaveBeenCalledTimes(2));
    expect(createSpace).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Startup", template_id: "startup" }),
    );
    expect(mocks.invite).toHaveBeenCalledWith("space-new", "sam@studio.dev");
    expect(mocks.invite).toHaveBeenCalledWith("space-new", "dana@studio.dev");
  });
});
