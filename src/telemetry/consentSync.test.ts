import { describe, expect, it, vi } from "vitest";
import { createConsentSync } from "./consentSync";

function harness() {
  const queue: (() => void)[] = [];
  const sender = vi.fn().mockResolvedValue(undefined);
  let signedIn = true;
  const sync = createConsentSync(
    () => (signedIn ? sender : null),
    (run) => queue.push(run),
  );
  const drain = async () => {
    while (queue.length) queue.shift()!();
    await Promise.resolve();
  };
  return { sync, sender, drain, signOut: () => (signedIn = false) };
}

describe("consent sync", () => {
  it("sends once per actual change, never for a re-applied identical pair", async () => {
    const { sync, sender, drain } = harness();
    sync.update(true, false);
    sync.update(true, false);
    await drain();
    for (let i = 0; i < 10; i++) sync.update(true, false);
    await drain();
    expect(sender).toHaveBeenCalledTimes(1);
    sync.update(false, false);
    await drain();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenLastCalledWith(false, false);
  });

  it("coalesces a burst into the final pair", async () => {
    const { sync, sender, drain } = harness();
    sync.update(true, true);
    sync.update(false, true);
    sync.update(false, false);
    await drain();
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith(false, false);
  });

  it("re-sends once for a new session and after a failed save, without looping", async () => {
    const { sync, sender, drain } = harness();
    sync.update(true, true);
    await drain();
    sync.reset();
    sync.update(true, true);
    await drain();
    expect(sender).toHaveBeenCalledTimes(2);
    sender.mockRejectedValueOnce(new Error("offline"));
    sync.update(false, true);
    await drain();
    await Promise.resolve();
    sync.update(false, true);
    await drain();
    expect(sender).toHaveBeenCalledTimes(4);
  });

  it("sends nothing while signed out", async () => {
    const { sync, sender, drain, signOut } = harness();
    signOut();
    sync.update(true, true);
    await drain();
    expect(sender).not.toHaveBeenCalled();
  });
});
