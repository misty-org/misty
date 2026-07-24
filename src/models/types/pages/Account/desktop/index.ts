import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui";
import { Alert, AlertDescription, AlertTitle } from "@/ui";
import { Avatar, AvatarFallback } from "@/ui";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Progress } from "@/ui";
import { LoadingState } from "@/ui";
import { StatusBadge } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import {
  accountCreateCheckout as createCheckout,
  accountCreatePortalSession as createPortalSession,
  accountFetchBillingUsage as fetchBillingUsage,
  accountFetchMe as fetchMe,
  accountUpdateDevice as updateDevice,
  accountUpdateProfile as updateProfile,
} from "@/stores/account/useAccountStore";
import type {
  BillingUsageResponse,
  AccountMeResponse as MeResponse,
} from "@/models/interfaces/stores/account/useAccountStore";
import { useUserStore } from "@/stores/account/useUserStore";
import { useSetupStore } from "@/stores/app";
import type { CurrentLicense } from "@/models/types/features/installer/types";
import { useAppStore } from "@/stores/app";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
} from "@/platform/clientDebug";
import type { ClientDebugEvent } from "@/models/interfaces/platform/clientDebug";
import { openExternalLink } from "@/platform/openExternalLink";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { Bug, Lock, Rows3, UserCircle, type LucideIcon } from "lucide-react";
import {
  DesktopSettingsFrame,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "@/pages/Settings/DesktopSettingsUI";

export type AccountStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type Tab = "general" | "account" | "privacy" | "diagnostics";
