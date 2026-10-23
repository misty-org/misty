import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AgentControlBar } from "./AgentControlBar";

it("offers no work-location choice", () => {
  render(<AgentControlBar />);
  expect(
    screen.queryByRole("button", { name: /this conversation|control this screen/i }),
  ).toBeNull();
});
