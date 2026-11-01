import { apiRequest } from "@/api/client/request";
import { ApiRequestError } from "@/api/client/errors";
import { deriveLoginCredential, isCredentialEmail } from "./store/accountCredential";

/** How the person proves it is them: their Misty password, or a fresh Google sign-in. */
export type AccountExportProof = { password: string } | { reauthenticationToken: string };

const refused = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "account_reauthentication_failed";

function exportBody(proof: AccountExportProof, password?: string) {
  return JSON.stringify(
    "reauthenticationToken" in proof
      ? { reauthentication_token: proof.reauthenticationToken }
      : { password },
  );
}

/**
 * The server's account export (`POST /me/export`): the account's data, and a link to each
 * note, drawing and file that works for 15 minutes. A Misty password is sent as the credential
 * derived on this device, and as typed only for an account this device hasn't seen sign in
 * with a credential (an older account still holds its password that way), as at sign-in.
 */
export async function requestAccountExport(
  email: string,
  proof: AccountExportProof,
): Promise<unknown> {
  const send = (password?: string) =>
    apiRequest<unknown>("/me/export", { method: "POST", body: exportBody(proof, password) });
  if ("reauthenticationToken" in proof) return send();
  const credential = await deriveLoginCredential(email, proof.password);
  if (!credential) return send(proof.password);
  try {
    return await send(credential);
  } catch (error) {
    if (!refused(error) || isCredentialEmail(email)) throw error;
    return send(proof.password);
  }
}

/** Saves the export as one JSON file the person keeps. */
export function saveAccountExport(data: unknown, now = new Date()): string {
  const name = `misty-account-${now.toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return name;
}

/** What the dialog says when the export couldn't be made. */
export function accountExportError(error: unknown): string {
  if (refused(error)) return "That password didn't work. Try again.";
  if (error instanceof ApiRequestError && error.code === "account_export_assets_unavailable")
    return "Your files can't be exported from this server right now. Try again later.";
  return "The export couldn't be made. Try again.";
}
