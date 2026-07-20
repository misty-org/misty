import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { cancelMikaMomentum, startMikaDrag } from "@/stores/backend";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { AppWindow, ArrowUpRight, MessageSquare, X } from "lucide-react";
import { motion, useMotionValue, useSpring } from "motion/react";
import {
  cloudFolderBotChatVisibilityEvent,
  cloudFolderBotNotifyEvent,
  dismissCloudFolderBotFromOverlay,
  openMikaAssistantFromBot,
  positionCloudFolderBotChatWindow,
  returnToMistyAppFromBot,
} from "@/features/bots/cloudFolderBot";
import type {
  CloudFolderBotNotification,
  CloudFolderBotChatVisibility,
} from "@/models/interfaces/features/bots/cloudFolderBot";
import { hasTauriInternals } from "@/platform/tauri";
import {
  hideRuntimeAssetOnError,
  revealRuntimeAssetOnLoad,
  runtimeAssetSource,
} from "@/platform/runtimeAsset";
import { useSettingsStore } from "@/stores/app";
import { Button } from "@/ui";

export type BotContextMenu = { x: number; y: number };

export type MikaNativeVelocity = { velocityX: number; velocityY: number };
