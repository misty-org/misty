import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn() }));
vi.mock("@/native/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/api/client/native-account-fetch", () => ({ nativeAccountFetch: mocks.fetch }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));

import { probeServer } from "./probe";
import { mistyCloudServer } from "./serverChoice";

const server = "https://misty.example.org/v1";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(new Response("ok"));
});
afterEach(() => vi.unstubAllEnvs());

it("refuses a domain on a private address in a release build, without contacting it", async () => {
  vi.stubEnv("DEV", false);
  mocks.invoke.mockResolvedValue(false);
  await expect(probeServer(server)).rejects.toThrow("private address");
  expect(mocks.invoke).toHaveBeenCalledWith("server_host_resolves_public", {
    host: "misty.example.org",
  });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("contacts a domain on a public address in a release build", async () => {
  vi.stubEnv("DEV", false);
  mocks.invoke.mockResolvedValue(true);
  await expect(probeServer(server)).resolves.toBe(true);
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it("doesn't check Misty's own server", async () => {
  vi.stubEnv("DEV", false);
  await expect(probeServer(mistyCloudServer())).resolves.toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("doesn't check in development", async () => {
  await expect(probeServer("http://127.0.0.1:8081/v1")).resolves.toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
});
