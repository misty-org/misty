import type { MistyAppSDK, MistyTerminalSDK } from "@misty/sdk";
import type { TerminalPreferences } from "@/features/settings/store/preferences";

/** The terminal view only knows these explicit services, never native invoke or host stores. */
export interface TerminalServices {
  terminal: MistyTerminalSDK;
  clipboard: Pick<MistyAppSDK["clipboard"], "readText" | "writeText">;
  openExternal(url: string): Promise<void>;
  reportError(error: string): void;
}
export type { TerminalPreferences };
