import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG_BASE_URL,
  githubSourceArchiveUrlForCatalog,
  normalizeCatalogBaseUrl,
} from "./catalog";

describe("extension catalog base URL", () => {
  // The catalog is fetched with no credentials, so a private repository answers
  // 404 and the marketplace silently renders empty. misty-org/misty is private;
  // misty-org/misty-extensions is the public publishing target.
  it("defaults to a repository that serves raw files anonymously", () => {
    expect(DEFAULT_CATALOG_BASE_URL).toBe(
      "https://raw.githubusercontent.com/misty-org/misty-extensions/main/catalog",
    );
    expect(DEFAULT_CATALOG_BASE_URL).not.toMatch(/raw\.githubusercontent\.com\/misty-org\/misty\//);
  });

  it("falls back to the default for empty configuration", () => {
    expect(normalizeCatalogBaseUrl(undefined)).toBe(DEFAULT_CATALOG_BASE_URL);
    expect(normalizeCatalogBaseUrl("   ")).toBe(DEFAULT_CATALOG_BASE_URL);
  });

  it("expands an owner/repo slug", () => {
    expect(normalizeCatalogBaseUrl("acme/widgets")).toBe(
      "https://raw.githubusercontent.com/acme/widgets/main/catalog",
    );
  });

  it("expands a GitHub repository URL", () => {
    expect(normalizeCatalogBaseUrl("https://github.com/acme/widgets")).toBe(
      "https://raw.githubusercontent.com/acme/widgets/main/catalog",
    );
    expect(normalizeCatalogBaseUrl("https://github.com/acme/widgets/")).toBe(
      "https://raw.githubusercontent.com/acme/widgets/main/catalog",
    );
  });

  it("expands a GitHub tree URL, honouring branch and path", () => {
    expect(normalizeCatalogBaseUrl("https://github.com/acme/widgets/tree/next/store")).toBe(
      "https://raw.githubusercontent.com/acme/widgets/next/store",
    );
    expect(normalizeCatalogBaseUrl("https://github.com/acme/widgets/tree/next")).toBe(
      "https://raw.githubusercontent.com/acme/widgets/next/catalog",
    );
  });

  it("passes a plain URL through without a trailing slash", () => {
    expect(normalizeCatalogBaseUrl("https://catalog.example.com/store/")).toBe(
      "https://catalog.example.com/store",
    );
  });

  it("derives the source archive from the catalog location", () => {
    expect(githubSourceArchiveUrlForCatalog(DEFAULT_CATALOG_BASE_URL)).toBe(
      "https://github.com/misty-org/misty-extensions/archive/refs/heads/main.zip",
    );
    expect(githubSourceArchiveUrlForCatalog("https://catalog.example.com/store")).toBeNull();
  });
});
