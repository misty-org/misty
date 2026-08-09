import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFetchAvatar: vi.fn<() => Promise<Blob>>(),
}));

vi.mock("../../store/useAccountStore", () => ({
  accountFetchAvatar: mocks.accountFetchAvatar,
}));

import { useAccountAvatarUrl } from "../useAccountAvatarUrl";

function AvatarUrlProbe({
  accountId,
  avatarVersion,
}: {
  accountId: string | null;
  avatarVersion: number;
}) {
  const avatarUrl = useAccountAvatarUrl(accountId, avatarVersion);
  return <output data-avatar-url={avatarUrl} />;
}

describe("useAccountAvatarUrl", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextObjectUrl: number;
  let createObjectURL: Mock<(object: Blob | MediaSource) => string>;
  let revokeObjectURL: Mock<(url: string) => void>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    nextObjectUrl = 0;
    mocks.accountFetchAvatar.mockReset();
    mocks.accountFetchAvatar.mockResolvedValue(new Blob(["avatar"], { type: "image/png" }));
    createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(
      () => `blob:avatar-${++nextObjectUrl}`,
    );
    revokeObjectURL = vi.fn<(url: string) => void>();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("refetches and replaces the object URL when account avatar data changes", async () => {
    await act(async () => {
      root.render(<AvatarUrlProbe accountId="account-1" avatarVersion={1} />);
    });

    expect(mocks.accountFetchAvatar).toHaveBeenCalledTimes(1);
    expect(container.querySelector("output")?.dataset.avatarUrl).toBe("blob:avatar-1");

    await act(async () => {
      root.render(<AvatarUrlProbe accountId="account-1" avatarVersion={2} />);
    });

    expect(mocks.accountFetchAvatar).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-1");
    expect(container.querySelector("output")?.dataset.avatarUrl).toBe("blob:avatar-2");

    await act(async () => {
      root.render(<AvatarUrlProbe accountId="account-2" avatarVersion={1} />);
    });

    expect(mocks.accountFetchAvatar).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:avatar-2");
    expect(container.querySelector("output")?.dataset.avatarUrl).toBe("blob:avatar-3");
  });

  it("uses the fallback path when the account has no uploaded avatar", async () => {
    await act(async () => {
      root.render(<AvatarUrlProbe accountId="account-1" avatarVersion={0} />);
    });

    expect(mocks.accountFetchAvatar).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.dataset.avatarUrl).toBe("");
  });
});
