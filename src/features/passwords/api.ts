import { invoke } from "@tauri-apps/api/core";

/** A saved sign-in as Settings lists it; passwords are read one at a time. */
export interface SavedLogin {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

export interface PasswordOffer {
  /** The browser page's native runtime id. */
  id: string;
  origin: string;
  username: string;
  /** A sign-in for this site and username exists with another password. */
  update: boolean;
}

export const passwordsApi = {
  list: () => invoke<SavedLogin[]>("browser_passwords_list"),
  reveal: (id: string) => invoke<string>("browser_passwords_reveal", { id }),
  remove: (id: string) => invoke<void>("browser_passwords_delete", { id }),
  save: (input: { id?: string; site: string; username: string; password: string }) =>
    invoke<void>("browser_passwords_save", {
      id: input.id ?? null,
      site: input.site,
      username: input.username,
      password: input.password,
    }),
  respondToOffer: (id: string, save: boolean) =>
    invoke<void>("browser_password_offer_respond", { id, save }),
};

export function siteLabel(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return origin;
  }
}
