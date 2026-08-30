import { ManagedAiRequestError } from "@/features/agents";
import { describe, expect, it } from "vitest";
import { pairingFailure } from "./ConnectedDevicePairingDialog";

describe("Connected Device pairing errors", () => {
  it.each([
    ["pairing_not_found", "Code not found"],
    ["pairing_expired", "Code expired"],
    ["pairing_locked", "Too many attempts"],
    ["invalid_pairing_state", "Pairing changed"],
  ])("turns %s into friendly modal copy", (code, title) => {
    const failure = pairingFailure(new ManagedAiRequestError("Request failed", 400, code));

    expect(failure.title).toBe(title);
    expect(failure.description).not.toContain(code);
  });

  it("never presents a raw JSON response", () => {
    const failure = pairingFailure(new Error('{"code":"pairing_not_found"}'));

    expect(failure.description).toBe("Check the pairing code and your connection, then try again.");
  });
});
