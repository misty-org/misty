import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

const storageKey = "misty-theme-test";

function ThemeValue() {
  const { theme } = useTheme();
  return <output aria-label="Current theme">{theme}</output>;
}

function renderTheme(defaultTheme: "light" | "dark" = "dark") {
  return render(
    <ThemeProvider defaultTheme={defaultTheme} storageKey={storageKey}>
      <ThemeValue />
      <ModeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeProvider and ModeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a persisted theme and applies it to the document", async () => {
    window.localStorage.setItem(storageKey, "light");

    renderTheme("dark");

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light");
      expect(document.documentElement).not.toHaveClass("dark");
      expect(document.documentElement.style.colorScheme).toBe("light");
    });
  });

  it("toggles the theme, persists it, and restores it after remounting", async () => {
    const user = userEvent.setup();
    const view = renderTheme("dark");

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
      expect(window.localStorage.getItem(storageKey)).toBe("dark");
    });

    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("light");
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light");
      expect(document.documentElement).not.toHaveClass("dark");
      expect(window.localStorage.getItem(storageKey)).toBe("light");
    });

    view.unmount();
    document.documentElement.classList.remove("light", "dark");
    renderTheme("dark");

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("light");
    await waitFor(() => expect(document.documentElement).toHaveClass("light"));
  });

  it("ignores an invalid stored value and uses the configured default", async () => {
    window.localStorage.setItem(storageKey, "system");

    renderTheme("light");

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("light");
    await waitFor(() => {
      expect(document.documentElement).toHaveClass("light");
      expect(window.localStorage.getItem(storageKey)).toBe("light");
    });
  });

  it("keeps theme switching usable when browser storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });

    renderTheme("dark");

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("dark");
    await user.click(screen.getByRole("button", { name: "Switch to light theme" }));

    expect(screen.getByLabelText("Current theme")).toHaveTextContent("light");
    await waitFor(() => expect(document.documentElement).toHaveClass("light"));
  });
});
