import type { SavedAccountSession } from "../stores/account/interfaces/useAuthTokenStore";

export type DemoAccount = Omit<SavedAccountSession, "lastUsedAt">;
