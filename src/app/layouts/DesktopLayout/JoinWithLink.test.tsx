import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { inviteToken, JoinWithLink } from "./JoinWithLink";

afterEach(cleanup);

it("reads an invite's token from its link, a web link to it, or the token alone", () => {
  expect(inviteToken("misty://open/invite/abc123TOKENxyz789")).toBe("abc123TOKENxyz789");
  expect(inviteToken("  https://misty.example/invite/tok_en-123456789012?x=1 ")).toBe(
    "tok_en-123456789012",
  );
  expect(inviteToken("abcdefghijklmnop")).toBe("abcdefghijklmnop");
  expect(inviteToken("not a link")).toBe("");
  expect(inviteToken("short")).toBe("");
});

function Route() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

it("opens the invitation's page from a pasted link, and says so when it isn't one", () => {
  render(
    <MemoryRouter initialEntries={["/spaces"]}>
      <JoinWithLink />
      <Route />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Join with a link" }));
  const field = screen.getByLabelText("Invite link");
  fireEvent.change(field, { target: { value: "nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(screen.getByText("That isn't an invite link.")).toBeTruthy();
  fireEvent.change(field, { target: { value: "misty://open/invite/abc123TOKENxyz789" } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(screen.getByTestId("route").textContent).toBe("/invite/abc123TOKENxyz789");
});
