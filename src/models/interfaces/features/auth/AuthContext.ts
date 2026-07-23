import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  accountFetchMe,
  accountLogout,
  isAccountUnauthorizedError,
} from "@/stores/account/useAccountStore";
import type { AccountMeResponse } from "@/models/interfaces/stores/account/useAccountStore";
import {
  activateAccountSession,
  clearAccountAuthToken,
  listSavedAccountSessions,
  updateSavedAccountSession,
} from "@/stores/account/useAuthTokenStore";
import type { SavedAccountSession } from "@/models/interfaces/stores/account/useAuthTokenStore";
import { isNativeMobileBuild } from "@/platform/buildTarget";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import { resetMikaAccountState } from "@/stores/assistant/useMikaSessionStore";
import { resetSpacesAccountState } from "@/stores/spaces/useSpacesStore";
import { useSetupStore } from "@/stores/app";
import { useUserStore } from "@/stores/account/useUserStore";
import { setAnalyticsAuthenticationState } from "@/analytics/lifecycle";
import { TelemetryIdentityManager } from "@/analytics/identity";
import { analytics } from "@/analytics/client";

export interface AuthUser {
  id: string;
  name: string;
  username?: string;
  email: string;
  avatarVersion?: number;
  accountCreatedAt?: string;
  currentPlan?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  accounts: SavedAccountSession[];
  transitioning: boolean;
  refreshUser: () => Promise<AuthUser | null>;
  authenticateAccount: (request: () => Promise<AuthUser>) => Promise<AuthUser>;
  switchAccount: (accountId: string) => Promise<void>;
  logout: () => Promise<void>;
}
