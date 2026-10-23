/**
 * The profile a window's browsing data belongs to: the signed-in account's id, or `local`
 * while nobody is signed in. Workspace recovery, extensions and first-run setup are kept per
 * profile, so Misty works as a full browser with no account
 * (docs/browser/no-account.md). The native side knows the same id.
 */
export const localProfileId = "local";

export function profileIdFor(accountId: string | null | undefined): string {
  return accountId?.trim() || localProfileId;
}

export function isLocalProfile(profileId: string): boolean {
  return profileId === localProfileId;
}
