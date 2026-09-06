import {
  mistyMailCacheContracts,
  type MailCacheData,
  type MailCacheSnapshot,
} from "@misty/contracts";
import type { MistyCall } from "./transport.js";
export interface MistyMailCacheSDK {
  read(): Promise<MailCacheSnapshot | null>;
  write(data: MailCacheData): Promise<void>;
  clear(): Promise<void>;
}
export function createMailCacheSDK(call: MistyCall): MistyMailCacheSDK {
  return Object.freeze({
    async read() {
      return mistyMailCacheContracts["mail.cache.read"].result.parse(
        await call("mail.cache.read", {}),
      );
    },
    async write(data: MailCacheData) {
      const params = mistyMailCacheContracts["mail.cache.write"].params.parse({
        data,
      });
      await call("mail.cache.write", params);
    },
    async clear() {
      await call("mail.cache.clear", {});
    },
  });
}
