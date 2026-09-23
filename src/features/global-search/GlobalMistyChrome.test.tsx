import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalMistyComposerBar } from "./GlobalMistyChrome";
vi.mock("./MistyAgentPicker", () => ({ MistyAgentPicker: () => <button>Editor</button> }));
afterEach(cleanup);
it("keeps attachment/options icon-only and separates microphone recording from input selection", async () => {
  const voice = {
    recording: false,
    requesting: false,
    transcribing: false,
    start: vi.fn(),
    stop: vi.fn(),
    refreshInputDevices: vi.fn(),
    selectInputDevice: vi.fn(),
    inputDevices: [{ deviceId: "usb", label: "USB microphone" }],
    selectedInputDeviceId: "",
  };
  const props = {
    accountId: "account",
    headerControls: <button>History</button>,
    query: "",
    onQuery: vi.fn(),
    mode: "ask",
    conversationActive: false,
    textareaRef: createRef<HTMLTextAreaElement>(),
    attachments: [],
    onModeChange: vi.fn(),
    onAddFiles: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onSubmit: vi.fn(),
    onCapture: vi.fn(),
    onKeyDown: vi.fn(),
    busy: false,
    working: false,
    activeConversationId: "",
    voice,
    onError: vi.fn(),
    onClose: vi.fn(),
    onModelChange: vi.fn(),
    reasoningEffort: "high",
    onToggleSettings: vi.fn(),
  } as unknown as ComponentProps<typeof GlobalMistyComposerBar>;
  render(<GlobalMistyComposerBar {...props} />);
  expect(screen.getByRole("button", { name: "Add attachments" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "Thinking options" }).textContent).toBe("");
  fireEvent.pointerDown(screen.getByRole("button", { name: /Choose microphone/ }), {
    button: 0,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: "USB microphone" }));
  expect(voice.selectInputDevice).toHaveBeenCalledWith("usb");
  expect(voice.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Talk to Misty" }));
  expect(voice.start).toHaveBeenCalledOnce();
});
