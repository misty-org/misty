import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  moveTo: vi.fn(),
  redeemOn: vi.fn(),
  redeem: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/api/deployment/probe", () => ({ probeServer: mocks.probe }));
vi.mock("@/features/account/api/api", () => ({ accountApi: { redeemSetupKeyOn: mocks.redeemOn } }));
vi.mock("../sessions/useAccountStore", () => ({
  accountRedeemSetupKey: mocks.redeem,
  accountFinishSetupKey: mocks.finish,
}));
vi.mock("./useServerSwitch", () => ({ useServerSwitch: () => ({ moveTo: mocks.moveTo }) }));

import { useServerChoice } from "@/api/deployment/serverChoice";
import { CloudScreen } from "./CloudScreen";
import { useSetupLinkStore } from "./setupLinkStore";

const key = "misty_setup_ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const answer = { user_id: "account-a", username: "ada", email: "ada@misty.example" };

async function submit(address: string) {
  const onRedeemed = vi.fn();
  render(<CloudScreen onRedeemed={onRedeemed} onBusy={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Sign-in link"), { target: { value: address } });
  fireEvent.change(screen.getByLabelText("Setup key"), { target: { value: key } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Continue" })));
  return onRedeemed;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.probe.mockResolvedValue(true);
  mocks.moveTo.mockResolvedValue(undefined);
  mocks.finish.mockResolvedValue({ id: "account-a" });
  mocks.redeem.mockResolvedValue({ id: "account-a" });
  useSetupLinkStore.setState({ link: null });
  useServerChoice.setState({
    loaded: true,
    choice: { mode: "server", url: "https://current.misty.example/v1" },
  });
});
afterEach(cleanup);

it("stays on the current server when the new one refuses the key", async () => {
  mocks.redeemOn.mockRejectedValue(new Error("This setup key is not valid."));
  const onRedeemed = await submit("other.misty.example");
  expect(mocks.redeemOn).toHaveBeenCalledWith("https://other.misty.example/v1", key);
  expect(mocks.moveTo).not.toHaveBeenCalled();
  expect(onRedeemed).not.toHaveBeenCalled();
  expect(screen.getByText("This setup key is not valid.")).toBeTruthy();
});

it("stays on the current server when the new one doesn't answer", async () => {
  mocks.probe.mockResolvedValue(false);
  await submit("other.misty.example");
  expect(mocks.redeemOn).not.toHaveBeenCalled();
  expect(mocks.moveTo).not.toHaveBeenCalled();
});

it("moves only after the new server took the key, then signs in with its answer", async () => {
  mocks.redeemOn.mockResolvedValue(answer);
  const onRedeemed = await submit("other.misty.example");
  expect(mocks.redeemOn.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.moveTo.mock.invocationCallOrder[0],
  );
  expect(mocks.moveTo).toHaveBeenCalledWith("https://other.misty.example/v1");
  expect(mocks.finish).toHaveBeenCalledWith(answer);
  expect(onRedeemed).toHaveBeenCalled();
});

it("redeems in place on the server this device already uses", async () => {
  const onRedeemed = await submit("current.misty.example");
  expect(mocks.redeemOn).not.toHaveBeenCalled();
  expect(mocks.redeem).toHaveBeenCalledWith(key);
  expect(onRedeemed).toHaveBeenCalled();
});
