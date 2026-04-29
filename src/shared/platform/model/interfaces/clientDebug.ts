import type { ClientDebugLevel } from "@/shared/platform/model/types/clientDebug";

export interface ClientDebugEvent {
  id: string;
  createdAt: string;
  level: ClientDebugLevel;
  scope: string;
  message: string;
  detail?: string;
}
