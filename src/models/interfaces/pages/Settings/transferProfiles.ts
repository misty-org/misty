import type { TransferProfileOptions } from "@/models/interfaces/services/misty-api";

export interface TransferProfileRecord {
  id: string;
  name: string;
  transfers: number;
  checkers: number;
  bandwidthLimit: string;
  retries: number;
  lowLevelRetries: number;
  checksum: boolean;
  builtIn: boolean;
}
