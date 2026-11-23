import "./agent_cloud_avatars.test_fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoticeViewport, resetNotices } from "@misty/ui";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/features/agents/personal/personal_agents_api", () => ({ personalAgentsApi: { save } }));
const speech = vi.hoisted(() => {
  const state = {
    catalog: {
      voices: [
        {
          id: "kokoro-heart",
          name: "Heart",
          languages: ["en"],
          accent: "US",
          installed: true,
          packageKey: "kokoro",
        },
      ],
      installing: [] as string[],
    },
    error: null,
    progress: {},
    failures: {},
    load: async () => {},
    install: async () => {},
  };
  const useSpeechModels = Object.assign((pick: (value: typeof state) => unknown) => pick(state), {
    getState: () => state,
  });
  return { useSpeechModels };
});
vi.mock("@/features/voice", () => ({
  useSpeechModels: speech.useSpeechModels,
  personLanguages: () => ["en"],
  previewVoice: async () => {},
  voicesFor: (voices: unknown[]) => voices,
}));
import { AgentSetup } from "./AgentSetup";
const access = {
  accountId: "owner",
  agentId: "",
  connections: [],
  loading: false,
  connectionsError: false,
  deviceError: false,
  retry: vi.fn(),
};
afterEach(() => {
  cleanup();
  act(() => resetNotices());
});
beforeEach(() => save.mockReset());
const start = (onSaved = vi.fn(async () => {})) => {
  render(
    <>
      <NoticeViewport />
      <AgentSetup
        access={access}
        onConnections={vi.fn()}
        onStatusChange={vi.fn()}
        onSaved={onSaved}
      />
    </>,
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Research partner" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Compare sources" } });
  fireEvent.click(screen.getByRole("button", { name: "Heart" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  return onSaved;
};
it("preserves identity across steps and saves an account-wide profile without invented permissions", async () => {
  save.mockResolvedValue({ id: "created" });
  const done = start();
  expect(
    screen.getByText("Connected apps belong to your account. Every agent can use them."),
  ).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Computer" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Research partner");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("radio", { name: /Desktop companion/ }).hasAttribute("disabled")).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith("created", false));
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0]).toMatchObject({
    name: "Research partner",
    description: "Compare sources",
    voice: "kokoro-heart",
    model_mode: "automatic",
    enabled: true,
  });
  expect(save.mock.calls[0][0]).not.toHaveProperty("app_ids");
  expect(save.mock.calls[0][0]).not.toHaveProperty("device_id");
});
it("retries completion without creating a duplicate after a successful save", async () => {
  save.mockResolvedValue({ id: "created" });
  const done = vi
    .fn()
    .mockRejectedValueOnce(new Error("Refresh failed"))
    .mockResolvedValue(undefined);
  start(done);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Refresh failed"));
  fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(2));
  expect(save).toHaveBeenCalledOnce();
});
