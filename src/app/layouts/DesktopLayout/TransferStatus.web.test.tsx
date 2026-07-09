import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransfersStore } from "@/features/transfers";
import type * as BuildTarget from "@/shared/platform/buildTarget";

vi.mock("@/shared/platform/buildTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof BuildTarget>()),
  isWebBuild: true,
}));

import { WorkStatusPopup } from "./TransferStatus";

describe("WorkStatusPopup in the web build", () => {
  beforeEach(() => {
    useTransfersStore.setState({
      transfers: null,
      load: vi.fn(),
    });
  });

  it("does not poll the native transfer snapshot", () => {
    const load = useTransfersStore.getState().load;
    render(<WorkStatusPopup />);
    expect(load).not.toHaveBeenCalled();
  });
});
