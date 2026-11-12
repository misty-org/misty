import { cleanup, render, screen } from "@testing-library/react";
import { Info } from "lucide-react";
import { afterEach, expect, it } from "vitest";
import { Prose, ProseCallout, ProseCode } from "./Prose";

afterEach(cleanup);

it("wraps rich text in the prose surface at a text role", () => {
  const { container } = render(
    <Prose size="body">
      <p>Hello</p>
    </Prose>,
  );
  const prose = container.querySelector("[data-slot=prose]")!;
  expect(prose.className).toContain("misty-prose");
  expect(prose.className).toContain("text-body");
});

it("names callouts and labels code blocks", () => {
  render(
    <Prose>
      <ProseCallout kind="tip" label="Tip" icon={Info}>
        <p>Try it</p>
      </ProseCallout>
      <ProseCode actions={<button type="button">Copy code</button>}>let a = 1;</ProseCode>
    </Prose>,
  );
  expect(screen.getByRole("complementary", { name: "Tip" })).toBeTruthy();
  expect(screen.getByText("Code")).toBeTruthy();
  expect(screen.getByText("let a = 1;").tagName).toBe("PRE");
});
