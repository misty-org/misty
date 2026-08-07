import { AlertCircle, Cloud, File, Images, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { SmartLibraryAsset } from "@/models/interfaces/services/misty-api";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Progress } from "@/ui";
import { safeTauriAssetUrl } from "@/platform/tauri";
import { useSmartLibraryStore } from "@/stores/media/useSmartLibraryStore";

export type SmartLibrary = NonNullable<ReturnType<typeof useSmartLibraryStore.getState>["library"]>;

export type SmartLibraryEstimate = ReturnType<typeof useSmartLibraryStore.getState>["estimate"];

export type SmartLibraryProgress = ReturnType<typeof useSmartLibraryStore.getState>["progress"];
