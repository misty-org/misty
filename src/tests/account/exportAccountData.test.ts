import { unzipSync, strFromU8 } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAccountExportArchive } from "@/features/account/exportAccountData";
import type { AccountExportManifest } from "@/models/interfaces/stores/account/useAccountStore";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("portable account export", () => {
  it("packages Journal state and checksum-verified R2 assets without bearer URLs", async () => {
    const manifest = exportManifest();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://worker.example/document") {
          return new Response(new TextEncoder().encode("journal-update"), { status: 200 });
        }
        if (url === "https://r2.example/asset") {
          return new Response(new TextEncoder().encode("hello"), { status: 200 });
        }
        return new Response("", { status: 404 });
      }),
    );

    const archive = unzipSync(
      new Uint8Array(await (await buildAccountExportArchive(manifest)).arrayBuffer()),
    );
    expect(strFromU8(archive["journal/notes/note_1.yjs"]!)).toBe("journal-update");
    expect(strFromU8(archive["assets/notes/asset_1-photo.png"]!)).toBe("hello");
    const packagedManifest = strFromU8(archive["manifest.json"]!);
    expect(packagedManifest).toContain('"format_version": 1');
    expect(packagedManifest).not.toContain("worker.example");
    expect(packagedManifest).not.toContain("r2.example");
  });

  it("rejects an R2 object whose checksum changed", async () => {
    const manifest = exportManifest();
    manifest.assets[0]!.sha256 = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            new TextEncoder().encode(url.includes("worker") ? "journal-update" : "hello"),
            { status: 200 },
          ),
      ),
    );
    await expect(buildAccountExportArchive(manifest)).rejects.toThrow("checksum");
  });
});

function exportManifest(): AccountExportManifest {
  return {
    account_data: { format_version: 1, account: { id: "user_1" } },
    documents: [
      {
        kind: "note",
        id: "note_1",
        space_id: "space_1",
        title: "Portable note",
        acl_version: 1,
        created_at: "2026-07-28T00:00:00Z",
        updated_at: "2026-07-28T00:00:00Z",
        download_url: "https://worker.example/document",
        expires_at: "2026-07-28T00:15:00Z",
      },
    ],
    assets: [
      {
        kind: "note",
        id: "asset_1",
        parent_id: "note_1",
        filename: "../../photo.png",
        mime_type: "image/png",
        byte_size: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        created_at: "2026-07-28T00:00:00Z",
        download: {
          url: "https://r2.example/asset",
          expires_at: "2026-07-28T00:15:00Z",
          filename: "photo.png",
          mime_type: "image/png",
          byte_size: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
      },
    ],
  };
}
