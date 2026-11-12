import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Bot, Paperclip } from "lucide-react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Command, CommandGroup, CommandItem, CommandList } from "./Command";
import { SuggestionItem, SuggestionList } from "./SuggestionList";

beforeAll(() => {
  // cmdk scrolls the picked row into view, which jsdom doesn't do.
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(cleanup);

it("draws a description line under a command's label", () => {
  render(
    <Command>
      <CommandList>
        <CommandGroup>
          <CommandItem icon={Paperclip} label="Upload files" description="Choose files to add" />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
  const option = screen.getByRole("option");
  expect(option.textContent).toContain("Upload files");
  expect(option.querySelector("[data-slot=command-item-description]")?.textContent).toBe(
    "Choose files to add",
  );
});

it("keeps a row's end control from picking the row", () => {
  const pick = vi.fn();
  const settings = vi.fn();
  render(
    <Command>
      <CommandList>
        <CommandGroup>
          <CommandItem
            icon={Bot}
            label="Writer"
            checked
            onSelect={pick}
            end={
              <button type="button" onClick={settings}>
                Settings
              </button>
            }
          />
        </CommandGroup>
      </CommandList>
    </Command>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(settings).toHaveBeenCalledOnce();
  expect(pick).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option"));
  expect(pick).toHaveBeenCalledOnce();
});

it("fades a suggestion's detail after its label", () => {
  render(
    <SuggestionList>
      <SuggestionItem selected icon={Bot} label="Writer" detail="Drafts and edits long text" />
    </SuggestionList>,
  );
  const detail = document.querySelector("[data-slot=suggestion-detail]")!;
  expect(detail.textContent).toBe("Drafts and edits long text");
  expect(detail.className).toContain("max-w-1/2");
});
