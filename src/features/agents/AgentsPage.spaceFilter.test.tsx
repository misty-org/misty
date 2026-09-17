import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useSpacesStore } from "@/features/spaces";
import { useAppsStore } from "@/features/apps/useAppsStore";
import { useWorkspaceStore } from "@/features/workspace";

const fixture = vi.hoisted(() => ({
  load: vi.fn(async () => {}),
  agent: {
    id: "communications",
    name: "Communications",
    role: "Coordinate launches",
    instructions: "",
    avatar: {},
    model_mode: "automatic",
    model_id: "",
    enabled: true,
  },
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./personalAgentsStore", () => ({
  usePersonalAgentsStore: () => ({
    agents: [fixture.agent],
    loading: false,
    error: "",
    load: fixture.load,
  }),
}));
vi.mock("@/api/agents/native", () => ({
  personalAgentsApi: {
    apps: async () => ({ app_ids: [] }),
    memories: async () => ({ memories: [] }),
  },
}));
vi.mock("@/api/assistant/api", () => ({
  assistantApi: { frontierModels: async () => ({ models: [] }) },
}));
vi.mock("./components/MistyDashboard", () => ({ MistyDashboard: () => null }));
vi.mock("./mcp/McpConnectionsSheet", () => ({ McpConnectionsSheet: () => null }));
vi.mock("@/features/misty/handoff", () => ({ openMisty: async () => {} }));
import AgentsPage from "./AgentsPage";

beforeEach(() => {
  useSpacesStore.setState({
    spaces: ["Studio", "Launch"].map((name) => ({
      id: name,
      name,
      owner_user_id: "owner",
      role: "owner" as const,
      member_count: 1,
      pending_count: 0,
      is_shared: false,
      is_default: name === "Studio",
      created_at: "",
      updated_at: "",
    })),
  });
  useWorkspaceStore.setState({ activeScopeKey: "space:Studio" });
  useAppsStore.setState({ catalog: [], installations: [], load: async () => {} });
});
afterEach(cleanup);

it("keeps unsaved agent fields until a Space switch is explicitly discarded", async () => {
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Communications/ }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch coordinator" } });
  const filter = screen.getByLabelText("Agent work Space") as HTMLSelectElement;
  fireEvent.change(filter, { target: { value: "Launch" } });
  expect(filter.value).toBe("Studio");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  expect(screen.getByRole("alert").textContent).toContain("unsaved changes");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Launch coordinator");
  fireEvent.change(filter, { target: { value: "Launch" } });
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(filter.value).toBe("Launch");
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Communications");
  expect(useWorkspaceStore.getState().activeScopeKey).toBe("space:Studio");
});

it("offers personal app assignments without a Space", async () => {
  useSpacesStore.setState({ spaces: [] });
  useWorkspaceStore.setState({ activeScopeKey: "global" });
  useAppsStore.setState({
    installations: [
      {
        app_id: "browser",
        state: "installed",
        installed_version: "1",
        permission_version: 1,
        granted_scopes: [],
        authority_generation: 1,
        pin_rank: 0,
        installed_at: "",
        updated_at: "",
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  expect(screen.getByRole("group", { name: "Personal apps" })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "browser" })).toBeTruthy();
  expect(screen.queryByText("Select a Space to assign apps.")).toBeNull();
});
