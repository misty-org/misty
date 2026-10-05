import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiProvidersApi, type AIProviderSettings } from "@/api/assistant/providers";
import type * as AIProvidersModule from "@/api/assistant/providers";
import type * as SettingsControlsModule from "../SettingsControls";
import { ModelProvidersSection } from "./ModelProvidersSection";

vi.mock("@/api/assistant/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof AIProvidersModule>();
  return {
    ...actual,
    aiProvidersApi: {
      settings: vi.fn(),
      create: vi.fn(),
      rotateKey: vi.fn(),
      remove: vi.fn(),
      saveRoutes: vi.fn(),
    },
  };
});
// Section behavior is under test, not Radix Select's portal and pointer mechanics.
vi.mock("../SettingsControls", async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsControlsModule>();
  return {
    ...actual,
    DropdownControl: (props: {
      value: string;
      label?: string;
      options: { value: string; label: string; disabled?: boolean }[];
      disabled?: boolean;
      onValueChange(value: string): void;
    }) => (
      <select
        aria-label={props.label}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onValueChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});
const chooseForAllTasks = async (value: string) =>
  fireEvent.change(await screen.findByLabelText("Connection for all tasks"), {
    target: { value },
  });
const roles = [
  {
    id: "agent",
    name: "Agent work",
    description: "Plans and calls tools.",
    providers: ["openai", "anthropic"],
    reasoning: true,
    optional: false,
  },
  {
    id: "vision",
    name: "Visual interaction",
    description: "Reads screenshots.",
    providers: ["openai", "anthropic"],
    reasoning: true,
    optional: false,
  },
  {
    id: "routing",
    name: "Task routing",
    description: "Routes follow-ups.",
    providers: ["openai"],
    reasoning: true,
    optional: false,
  },
  {
    id: "realtime",
    name: "Companion voice",
    description: "Realtime speech.",
    providers: ["openai"],
    reasoning: false,
    optional: false,
  },
  {
    id: "library-fallback",
    name: "Library second pass",
    description: "Optional extra request.",
    providers: ["openai"],
    reasoning: true,
    optional: true,
  },
] as AIProviderSettings["roles"];
const fixture: AIProviderSettings = {
  connections: [
    {
      id: "own-key",
      name: "Personal OpenAI",
      provider: "openai",
      base_url: "https://api.openai.com/v1",
    },
  ],
  routes: [],
  defaults: [],
  roles,
};

describe("account model provider settings", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(aiProvidersApi.settings).mockResolvedValue(structuredClone(fixture));
  });
  it("lets users review OpenAI defaults and disables optional extra calls before saving", async () => {
    render(<ModelProvidersSection />);
    await chooseForAllTasks("own-key");
    expect((screen.getByLabelText("Agent work model ID") as HTMLInputElement).value).toBe(
      "openai/gpt-6-luna",
    );
    expect((screen.getByLabelText("Companion voice model ID") as HTMLInputElement).value).toBe(
      "openai/gpt-realtime-2.1-mini",
    );
    expect(aiProvidersApi.saveRoutes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Save model choices"));
    await waitFor(() => expect(aiProvidersApi.saveRoutes).toHaveBeenCalledTimes(1));
    const routes = vi.mocked(aiProvidersApi.saveRoutes).mock.calls[0]![0];
    expect(routes.find((route) => route.role === "library-fallback")?.enabled).toBe(false);
    expect(routes.find((route) => route.role === "agent")?.reasoning).toBe("low");
    expect(JSON.stringify(routes)).not.toMatch(/api_key|ciphertext/);
  });
  it("writes a key only to connection creation and clears the password field", async () => {
    vi.mocked(aiProvidersApi.create).mockResolvedValue({
      id: "new-key",
      name: "Second key",
      provider: "openai",
      base_url: "https://api.openai.com/v1",
    });
    render(<ModelProvidersSection />);
    await screen.findByText("Provider connections");
    fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "Second key" } });
    fireEvent.change(screen.getByLabelText("Provider API key"), {
      target: { value: "fixture-secret" },
    });
    fireEvent.click(screen.getByText("Add connection"));
    await waitFor(() =>
      expect(aiProvidersApi.create).toHaveBeenCalledWith({
        name: "Second key",
        provider: "openai",
        base_url: "",
        api_key: "fixture-secret",
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Provider API key") as HTMLInputElement).value).toBe(""),
    );
    expect(document.body.textContent).not.toContain("fixture-secret");
    expect(aiProvidersApi.saveRoutes).not.toHaveBeenCalled();
  });
  it("keeps edits after a save failure and lets users retry", async () => {
    vi.mocked(aiProvidersApi.saveRoutes).mockRejectedValueOnce(new Error("Connection unavailable"));
    render(<ModelProvidersSection />);
    await chooseForAllTasks("own-key");
    fireEvent.click(screen.getByText("Save model choices"));
    expect((await screen.findByRole("alert")).textContent).toContain("Connection unavailable");
    expect((screen.getByLabelText("Agent work model ID") as HTMLInputElement).value).toBe(
      "openai/gpt-6-luna",
    );
    expect((screen.getByText("Save model choices") as HTMLButtonElement).disabled).toBe(false);
  });
  it("switches every supported task to one connection and back to Misty default", async () => {
    vi.mocked(aiProvidersApi.settings).mockResolvedValue({
      ...structuredClone(fixture),
      connections: [
        ...fixture.connections,
        {
          id: "claude",
          name: "Personal Anthropic",
          provider: "anthropic",
          base_url: "https://api.anthropic.com/v1",
        },
      ],
    });
    render(<ModelProvidersSection />);
    await chooseForAllTasks("claude");
    expect(screen.getByRole("status").textContent).toContain(
      "Personal Anthropic selected for 2 tasks; 3 it cannot run kept their choice",
    );
    fireEvent.change(screen.getByLabelText("Language model for all tasks"), {
      target: { value: "anthropic/claude-test" },
    });
    expect((screen.getByLabelText("Agent work model ID") as HTMLInputElement).value).toBe(
      "anthropic/claude-test",
    );
    expect((screen.getByLabelText("Visual interaction model ID") as HTMLInputElement).value).toBe(
      "anthropic/claude-test",
    );
    expect((screen.getByLabelText("Connection for all tasks") as HTMLSelectElement).value).toBe(
      "claude",
    );
    await chooseForAllTasks("server");
    expect((screen.getByLabelText("Agent work model ID") as HTMLInputElement).value).toBe("");
    // Every task is back on the saved Misty default, so nothing is left to save.
    expect((screen.getByText("Save model choices") as HTMLButtonElement).disabled).toBe(true);
  });
});
