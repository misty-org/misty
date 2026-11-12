import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PropertyList } from "./PropertyList";

afterEach(cleanup);

it("pairs each key with its value", () => {
  render(
    <PropertyList
      label="Run details"
      items={[
        { label: "Model", value: "Opus" },
        { label: "State", value: <span data-testid="mark" /> },
      ]}
    />,
  );
  const list = screen.getByLabelText("Run details");
  expect(list.tagName).toBe("DL");
  const terms = list.querySelectorAll("dt");
  const values = list.querySelectorAll("dd");
  expect([...terms].map((t) => t.textContent)).toEqual(["Model", "State"]);
  expect(values[0]!.textContent).toBe("Opus");
  expect(screen.getByTestId("mark")).toBeTruthy();
});
