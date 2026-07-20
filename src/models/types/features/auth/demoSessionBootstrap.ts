import { saveAccountAuthToken } from "@/stores/account/useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";

export type DemoAccount = Omit<SavedAccountSession, "lastUsedAt">;
