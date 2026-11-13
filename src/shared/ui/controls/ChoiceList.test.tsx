import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceList } from "./ChoiceList";

afterEach(cleanup);

const options = [{ label: "Yes", description: "Go ahead" }, { label: "No" }];

it("is a radio group with the picked row checked", () => {
  const onSelect = vi.fn();
  render(
    <ChoiceList
      label="Proceed?"
      options={options}
      selected={["Yes"]}
      onSelect={onSelect}
      shortcuts
    />,
  );
  expect(screen.getByRole("radiogroup", { name: "Proceed?" })).toBeTruthy();
  const yes = screen.getByRole("radio", { name: /Yes/ });
  expect(yes.getAttribute("aria-checked")).toBe("true");
  expect(yes.getAttribute("aria-keyshortcuts")).toBe("1");
  fireEvent.click(screen.getByRole("radio", { name: "No" }));
  expect(onSelect).toHaveBeenCalledWith("No");
});

it("is a group of checkboxes with multiple", () => {
  render(
    <ChoiceList label="Checks" multiple options={options} selected={[]} onSelect={() => {}} />,
  );
  expect(screen.getByRole("group", { name: "Checks" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
});
