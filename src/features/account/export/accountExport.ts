import { apiRequest } from "@/api/client/request";
import { ApiRequestError } from "@/api/client/errors";

/** How the person proves it is them: their Misty password, or a fresh Google sign-in. */
export type AccountExportProof = { password: string } | { reauthenticationToken: string };

const refused = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "account_reauthentication_failed";

/** What a request that needs the person to prove it is them sends. */
function proofFields(
  proof: AccountExportProof,
): { password: string } | { reauthentication_token: string } {
  return "reauthenticationToken" in proof
    ? { reauthentication_token: proof.reauthenticationToken }
    : { password: proof.password };
}

/**
 * The server's account export (`POST /me/export`): the account's data, and a link to each
 * note, drawing and file that works for 15 minutes.
 */
export function requestAccountExport(proof: AccountExportProof): Promise<unknown> {
  return apiRequest<unknown>("/me/export", {
    method: "POST",
    body: JSON.stringify(proofFields(proof)),
  });
}

/** Starts deleting the account (`POST /me/deletion`); the server removes it after 30 days. */
export async function requestAccountDeletion(proof: AccountExportProof): Promise<void> {
  await apiRequest<unknown>("/me/deletion", {
    method: "POST",
    body: JSON.stringify({ ...proofFields(proof), confirmation: "DELETE" }),
  });
}

/** What the dialog says when the account couldn't be deleted. */
export function accountDeletionError(error: unknown): string {
  if (refused(error)) return "That password didn't work. Try again.";
  if (error instanceof ApiRequestError && error.code === "account_deletion_space_ownership") {
    const names = ownedSpaceNames(error.responseText);
    return names
      ? `Hand over or delete the Spaces you own first: ${names}.`
      : "Hand over or delete the Spaces you own first.";
  }
  if (error instanceof ApiRequestError && error.code === "account_deletion_already_pending")
    return "This account is already being deleted.";
  return "The account couldn't be deleted. Try again.";
}

function ownedSpaceNames(responseText: string): string {
  try {
    const { spaces } = JSON.parse(responseText) as { spaces?: { name: string }[] };
    return (spaces ?? []).map((space) => space.name).join(", ");
  } catch {
    return "";
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
