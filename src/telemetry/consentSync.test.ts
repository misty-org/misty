import { describe, expect, it, vi } from "vitest";
import { ConsentSync } from "./consentSync";

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("consent synchronization", () => {
  it("coalesces in-flight projections and sends only the latest change serially", async () => {
    const pending = deferred();
    const write = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const sync = new ConsentSync(write);
    sync.update("a", [false, false]);
    sync.update("a", [true, false]);
    sync.update("a", [true, true]);
    expect(write).toHaveBeenCalledTimes(1);
    pending.resolve();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenLastCalledWith(true, true);
    sync.update("a", [true, true]);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
  });
  it("does not mark failed writes as acknowledged or loop on failure", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const sync = new ConsentSync(write);
    sync.update("a", [false, false]);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    sync.update("a", [false, false]);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  });
  it("fences old acknowledgements and sends initial consent again after reauthentication", async () => {
    const pending = deferred();
    const write = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    const sync = new ConsentSync(write);
    sync.update("a", [false, false]);
    sync.update(null, [false, false]);
    sync.update("a", [false, false]);
    pending.resolve();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    sync.update("b", [false, false]);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
  });
  it("drops unsent consent when authentication is lost", async () => {
    const pending = deferred();
    const write = vi.fn().mockReturnValue(pending.promise);
    const sync = new ConsentSync(write);
    sync.update("a", [false, false]);
    sync.update("a", [true, true]);
    sync.update(null, [false, false]);
    pending.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
  });
});
