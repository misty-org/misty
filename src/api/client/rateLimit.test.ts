import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./cookie-session", () => ({ cookieSessionFetch: mocks.fetch }));
import { httpRequest } from "./http";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

it("stops requests to a blocked origin until Retry-After without replaying mutations", async () => {
  vi.useFakeTimers();
  const url = "https://cooldown-one.example/api/apps";
  mocks.fetch.mockResolvedValueOnce(
    new Response("temporarily blocked", {
      status: 429,
      headers: { "Retry-After": "120", "X-Misty-RateLimit-Scope": "origin" },
    }),
  );
  expect((await httpRequest(url)).status).toBe(429);
  expect((await httpRequest("https://cooldown-one.example/api/agents")).status).toBe(429);
  expect((await httpRequest(url, { method: "POST", body: "mutation" })).status).toBe(429);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  mocks.fetch.mockResolvedValueOnce(new Response("ok"));
  expect((await httpRequest(url)).status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("shares cooldown storage with a fresh renderer and isolates other deployments", async () => {
  vi.useFakeTimers();
  localStorage.setItem(
    "misty:http-cooldown:v1:https://cooldown-two.example",
    String(Date.now() + 60_000),
  );
  expect((await httpRequest("https://cooldown-two.example/api/a")).status).toBe(429);
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.fetch.mockResolvedValueOnce(new Response("ok"));
  expect((await httpRequest("https://different.example/api/a")).status).toBe(200);
});

it("keeps route limits from blocking unrelated controls", async () => {
  mocks.fetch.mockResolvedValueOnce(
    new Response("too many requests", {
      status: 429,
      headers: { "Retry-After": "60", "X-Misty-RateLimit-Scope": "route" },
    }),
  );
  await httpRequest("https://cooldown-three.example/api/apps");
  expect((await httpRequest("https://cooldown-three.example/api/apps")).status).toBe(429);
  mocks.fetch.mockResolvedValueOnce(new Response("ok"));
  expect(
    (await httpRequest("https://cooldown-three.example/api/run/cancel", { method: "POST" })).status,
  ).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
