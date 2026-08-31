import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginEntry } from "../model/types";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { resolveArtifactChecksum } from "./pluginCatalog";

describe("resolveArtifactChecksum", () => {
  beforeEach(() => invoke.mockReset());

  it("uses an inline catalog checksum without making another request", async () => {
    const checksum = "a".repeat(64);

    await expect(
      resolveArtifactChecksum(plugin({ artifact: { ...artifact(), sha256: checksum } })),
    ).resolves.toBe(checksum);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads verified sidecar checksums through the native downloader", async () => {
    const checksum = "b".repeat(64);
    invoke.mockResolvedValue(checksum);

    await expect(resolveArtifactChecksum(plugin())).resolves.toBe(checksum);
    expect(invoke).toHaveBeenCalledWith("fetch_plugin_bundle_checksum", {
      url: artifact().url,
    });
  });

  it("does not request a checksum for unverified catalog entries", async () => {
    await expect(resolveArtifactChecksum(plugin({ verified: false }))).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects invalid checksums returned by the native downloader", async () => {
    invoke.mockResolvedValue("not-a-checksum");

    await expect(resolveArtifactChecksum(plugin())).rejects.toThrow(
      "The published checksum for Storage Report is invalid.",
    );
  });
});

function artifact() {
  return {
    platform: "macos-aarch64",
    url: "https://github.com/misty-org/misty-extensions/releases/download/v0.3.0/storage_report-macos-aarch64.zip",
  };
}

function plugin(overrides: Partial<PluginEntry> = {}): PluginEntry {
  return {
    id: "storage_report",
    name: "Storage Report",
    version: "0.3.0",
    author: "Misty",
    overview: "",
    status: "available",
    root: "private",
    installed: false,
    enabled: false,
    verified: true,
    capabilities: [],
    where_it_appears: [],
    permissions: [],
    getting_started: [],
    changelog: [],
    included_tools: [],
    links: [],
    actions: [],
    launcher: {
      views: ["Files"],
      show_in_launcher: true,
      requires_selected_file: true,
      open_mode: "tab",
    },
    artifact: artifact(),
    ...overrides,
  };
}
