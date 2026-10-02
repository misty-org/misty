import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./DropdownMenu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
} from "./ContextMenu";

afterEach(cleanup);

function Menu({ context }: { context: boolean }) {
  const [value, setValue] = useState("recent");
  const Root = context ? ContextMenu : DropdownMenu;
  const Trigger = context ? ContextMenuTrigger : DropdownMenuTrigger;
  const Content = context ? ContextMenuContent : DropdownMenuContent;
  const Group = context ? ContextMenuRadioGroup : DropdownMenuRadioGroup;
  const Item = context ? ContextMenuRadioItem : DropdownMenuRadioItem;
  return (
    <Root>
      <Trigger asChild>
        <button>Sort</button>
      </Trigger>
      <Content>
        <Group value={value} onValueChange={setValue}>
          <Item value="recent" onSelect={(event) => event.preventDefault()}>
            Recent
          </Item>
          <Item value="name" onSelect={(event) => event.preventDefault()}>
            Name
          </Item>
        </Group>
      </Content>
    </Root>
  );
}

it.each([false, true])("uses checkmarks and preserves single selection (context=%s)", (context) => {
  render(<Menu context={context} />);
  const trigger = screen.getByRole("button", { name: "Sort" });
  if (context) fireEvent.contextMenu(trigger);
  else fireEvent.keyDown(trigger, { key: "Enter" });
  const recent = screen.getByRole("menuitemradio", { name: "Recent" });
  const name = screen.getByRole("menuitemradio", { name: "Name" });
  expect(recent.getAttribute("aria-checked")).toBe("true");
  expect(recent.querySelector("svg.lucide-check")).toBeTruthy();
  expect(recent.querySelector("circle")).toBeNull();
  expect(name.querySelector("svg")).toBeNull();
  fireEvent.click(name);
  expect(name.getAttribute("aria-checked")).toBe("true");
  expect(name.querySelector("svg.lucide-check")).toBeTruthy();
  expect(recent.getAttribute("aria-checked")).toBe("false");
  expect(recent.querySelector("svg")).toBeNull();
});
