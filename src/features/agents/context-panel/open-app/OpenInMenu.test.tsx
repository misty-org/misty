// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/shared/platform/nativeInvoke", () => native);
vi.mock("../../personal/agentAccount", () => ({ agentAccountId: () => "me" }));

import { useFolderSettings } from "../folders/folderSettings";
import { availableTargets, chosenTarget, useOpenApps } from "./openApp";
import { NoticeViewport } from "@/shared/ui";
import { OpenInMenu } from "./OpenInMenu";

afterEach(cleanup);

type Request = { kind: string; id?: string; path?: string };

/** A computer with VS Code and IntelliJ installed and one added program. */
function nativeComputer(programs = [{ id: "p1", name: "Nova", path: "/Applications/Nova.app" }]) {
  native.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "project_program_icon") {
      const target = args?.target as string;
      return {
        installed: ["vscode", "idea", "finder"].includes(target) || target.startsWith("custom:"),
      };
    }
    if (command === "project_open_custom") {
      const request = args?.request as Request;
      if (request.kind === "add") {
        programs = [
          ...programs,
          { id: "p2", name: "Sublime Merge", path: "/Applications/Sublime Merge.app" },
        ];
        return { programs, added: programs[programs.length - 1] };
      }
      if (request.kind === "remove") programs = programs.filter((p) => p.id !== request.id);
      return { programs };
    }
    if (command === "settings_session_state") return { revision: 0, state: null };
    return undefined;
  });
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Open in another app" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("OpenInMenu", () => {
  beforeEach(() => {
    native.invoke.mockReset();
    useOpenApps.setState({ icons: {}, programs: [], loaded: false });
    useFolderSettings.setState({ byFolder: {} });
  });

  it("opens the folder in VS Code by default and reports a failure", async () => {
    nativeComputer();
    render(
      <>
        <OpenInMenu folder="/repo/app" />
        <NoticeViewport />
      </>,
    );
    const button = await screen.findByRole("button", { name: "Open in VS Code" });
    native.invoke.mockRejectedValueOnce(new Error("not found"));
    fireEvent.click(button);
    expect(native.invoke).toHaveBeenCalledWith("project_open_in", {
      account: "me",
      path: "/repo/app",
      target: "vscode",
    });
    await waitFor(() =>
      expect(screen.getByText(/Couldn't open in VS Code: not found/)).toBeTruthy(),
    );
  });

  it("offers only installed apps, checks the chosen one and remembers a new choice", async () => {
    nativeComputer();
    render(<OpenInMenu folder="/repo/app" />);
    await screen.findByRole("button", { name: "Open in VS Code" });
    openMenu();
    expect(await screen.findByRole("menuitem", { name: /IntelliJ IDEA/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Cursor/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Nova/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /IntelliJ IDEA/ }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("project_open_in", {
        account: "me",
        path: "/repo/app",
        target: "idea",
      }),
    );
    expect(native.invoke).toHaveBeenCalledWith(
      "settings_session_commit",
      expect.objectContaining({ document: { openIn: "idea" } }),
    );
  });

  it("adds a program through the native dialog and opens the folder in it", async () => {
    nativeComputer();
    render(<OpenInMenu folder="/repo/app" />);
    await screen.findByRole("button", { name: "Open in VS Code" });
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add a program" }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith("project_open_custom", {
        account: "me",
        request: { kind: "open", id: "p2", path: "/repo/app" },
      }),
    );
    expect(useOpenApps.getState().programs.map((p) => p.name)).toEqual(["Nova", "Sublime Merge"]);
  });

  it("drops a removed program and falls back to the default", () => {
    const icons = { vscode: { installed: true }, finder: { installed: true } };
    const programs = [{ id: "p1", name: "Nova", path: "/n" }];
    const targets = availableTargets(icons, programs);
    expect(targets.map((t) => t.id)).toEqual(["vscode", "finder", "custom:p1"]);
    expect(chosenTarget(targets, "custom:p1")?.label).toBe("Nova");
    expect(chosenTarget(availableTargets(icons, []), "custom:p1")?.id).toBe("vscode");
    expect(chosenTarget(availableTargets({ finder: { installed: true } }, []), undefined)?.id).toBe(
      "finder",
    );
  });
});
