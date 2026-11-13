import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { browserLibrary } from "../library/native";
import { ClearWebsiteDataDialog } from "./ClearWebsiteDataDialog";

afterEach(() => vi.restoreAllMocks());

it("clears the chosen kinds of website data and reports it", async () => {
  const clear = vi.spyOn(browserLibrary, "clearWebsiteData").mockResolvedValue();
  const onCleared = vi.fn();
  render(<ClearWebsiteDataDialog open onOpenChange={() => undefined} onCleared={onCleared} />);
  fireEvent.click(screen.getByRole("checkbox", { name: /Cookies and site data/ }));
  fireEvent.click(screen.getByRole("button", { name: "Clear data" }));
  await waitFor(() => expect(clear).toHaveBeenCalled());
  expect(clear.mock.calls[0][0].kinds).toEqual(["cache", "cookies"]);
  await waitFor(() => expect(onCleared).toHaveBeenCalled());
});
