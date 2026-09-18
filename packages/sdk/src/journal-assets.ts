import { mistyJournalAssetContracts, MISTY_JOURNAL_ASSET_CHUNK_BYTES,
  type MistyJournalAssetMethod, type MistyJournalAssetParams, type MistyJournalAssetResult } from "@misty/contracts";
import type { MistyCall } from "./transport.js";

export function createJournalAssetsSDK(call: MistyCall) {
  const request = async <M extends MistyJournalAssetMethod>(method: M, params: MistyJournalAssetParams<M>): Promise<MistyJournalAssetResult<M>> => {
    const contract = mistyJournalAssetContracts[method];
    return contract.result.parse(await call(method, contract.params.parse(params))) as MistyJournalAssetResult<M>;
  };
  return Object.freeze({
    async upload(input: Omit<MistyJournalAssetParams<"journal.assets.begin">, "bytes" | "mimeType"> & { file: Blob }) {
      const { file, ...target } = input;
      const { handle } = await request("journal.assets.begin", { ...target, bytes: file.size, mimeType: file.type as MistyJournalAssetParams<"journal.assets.begin">["mimeType"] });
      try {
        for (let offset = 0; offset < file.size; offset += MISTY_JOURNAL_ASSET_CHUNK_BYTES) {
          const bytes = new Uint8Array(await file.slice(offset, offset + MISTY_JOURNAL_ASSET_CHUNK_BYTES).arrayBuffer());
          await request("journal.assets.write", { handle, offset, data: toBase64(bytes) });
        }
        return await request("journal.assets.commit", { handle });
      } finally { await request("journal.assets.close", { handle }).catch(() => undefined); }
    },
    async download(input: MistyJournalAssetParams<"journal.assets.open">) {
      const descriptor = await request("journal.assets.open", input);
      try {
        const parts: ArrayBuffer[] = [];
        for (let offset = 0; offset < descriptor.bytes; offset += MISTY_JOURNAL_ASSET_CHUNK_BYTES) {
          const length = Math.min(MISTY_JOURNAL_ASSET_CHUNK_BYTES, descriptor.bytes - offset);
          const { data } = await request("journal.assets.read", { handle: descriptor.handle, offset, length });
          const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
          if (bytes.length !== length) throw new Error("Misty returned an incomplete Journal asset.");
          parts.push(bytes.buffer);
        }
        return { file: new Blob(parts, { type: descriptor.mimeType }), filename: descriptor.filename, sha256: descriptor.sha256 };
      } finally { await request("journal.assets.close", { handle: descriptor.handle }).catch(() => undefined); }
    },
  });
}
export type MistyJournalAssetsSDK = ReturnType<typeof createJournalAssetsSDK>;
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
