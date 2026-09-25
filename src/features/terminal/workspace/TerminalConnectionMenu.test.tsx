import { act, type InputHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalConnectionMenu } from "./TerminalConnectionMenu";
import type { SshEnvironment } from "./sshEnvironments";

vi.mock("@/shared/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/shared/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    onValueChange,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { onValueChange?: (value: string) => void }) => (
    <input {...props} onChange={(event) => onValueChange?.(event.currentTarget.value)} />
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children, heading }: { children: ReactNode; heading?: string }) => (
    <section aria-label={heading}>{children}</section>
  ),
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => (
    <button onClick={onSelect}>{children}</button>
  ),
  CommandEmpty: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandSeparator: () => <hr />,
}));

const savedEnvironment: SshEnvironment = {
  source: "configured",
  id: "production",
  label: "Production",
  host: "prod.example.com",
  user: "deploy",
  port: 2222,
  configPath: "/Users/local/.ssh/config",
  deviceLocal: true,
  agentTools: "device_local",
};

describe("TerminalConnectionMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows saved connections and submits a direct OpenSSH destination", async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <TerminalConnectionMenu
          environment={{ kind: "local" }}
          environments={[savedEnvironment]}
          onSelect={onSelect}
        />,
      );
    });

    expect(container.textContent).toContain("Production");
    const input = container.querySelector<HTMLInputElement>('input[aria-label="SSH connection"]');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "ssh deploy@example.com -p 2200",
      );
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const connectButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Connect with OpenSSH"),
    );
    expect(connectButton).toBeDefined();
    await act(async () => connectButton!.click());

    expect(onSelect).toHaveBeenCalledWith({
      kind: "ssh",
      ssh: {
        source: "direct",
        id: "direct:deploy@example.com:2200",
        label: "deploy@example.com",
        host: "example.com",
        user: "deploy",
        port: 2200,
        deviceLocal: true,
        agentTools: "device_local",
      },
    });
  });
});
