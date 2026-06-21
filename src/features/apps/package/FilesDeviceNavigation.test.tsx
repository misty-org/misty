import { useState } from "react";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SidebarDeviceGroup,
  sidebarStyles,
} from "../../../../../misty-apps/apps/files/workspace/explorer/components/ExplorerSidebarSupport";

afterEach(cleanup);

function Devices({ connect }: { connect: () => void }) {
  const [localOpen, setLocalOpen] = useState(true);
  const [networkOpen, setNetworkOpen] = useState(true);
  return (
    <div className={sidebarStyles.list}>
      <SidebarDeviceGroup title="Local" open={localOpen} onOpenChange={setLocalOpen} last={false}>
        <button>Macintosh HD</button>
        <button>Backup drive</button>
      </SidebarDeviceGroup>
      <SidebarDeviceGroup
        title="Network"
        open={networkOpen}
        onOpenChange={setNetworkOpen}
        last
        actions={<button onClick={connect}>Connect another device</button>}
      >
        <button>Studio Mac</button>
      </SidebarDeviceGroup>
    </div>
  );
}

it("keeps local and network devices in independently controlled subsections", () => {
  const ui = render(<Devices connect={vi.fn()} />);
  const local = ui.getByRole("group", { name: "Local devices" });
  const network = ui.getByRole("group", { name: "Network devices" });
  expect(
    within(local)
      .getAllByRole("button")
      .map((e) => e.textContent),
  ).toEqual(["Macintosh HD", "Backup drive"]);
  expect(within(network).getByRole("button", { name: "Studio Mac" })).toBeTruthy();
  const toggle = ui.getByRole("button", { name: "Local" });
  expect(toggle.getAttribute("aria-controls")).toBe(local.id);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(ui.queryByRole("button", { name: "Macintosh HD" })).toBeNull();
  expect(ui.getByRole("button", { name: "Studio Mac" })).toBeTruthy();
  fireEvent.click(ui.getByRole("button", { name: "Network" }));
  expect(ui.queryByRole("button", { name: "Studio Mac" })).toBeNull();
  fireEvent.click(toggle);
  expect(ui.getByRole("button", { name: "Macintosh HD" })).toBeTruthy();
  expect(ui.queryByRole("button", { name: "Studio Mac" })).toBeNull();
});

it("keeps the connection action separate from the network disclosure", () => {
  const connect = vi.fn();
  const ui = render(<Devices connect={connect} />);
  fireEvent.click(ui.getByRole("button", { name: "Connect another device" }));
  expect(connect).toHaveBeenCalledOnce();
  expect(
    ui.getByRole("button", { name: "Network" }).getAttribute("aria-expanded"),
  ).toBe("true");
});
