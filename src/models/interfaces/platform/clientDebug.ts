import type { ClientDebugLevel } from "@/models/types/platform/clientDebug";

export interface ClientDebugEvent {
  id: string;
  createdAt: string;
  level: ClientDebugLevel;
  scope: string;
  message: string;
  detail?: string;
}
