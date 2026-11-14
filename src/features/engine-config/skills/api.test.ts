// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
/**
 * IPC shape regression: native `engine_skills_mutate` takes two arguments
 * (`action: String`, `payload: Value`), and queries take (`mode`, `params`).
 * Flattening a mutation's arguments into one object once made every mutation
 * (install / adopt / sync / uninstall) fail with "invalid args `payload` …
 * missing required key payload".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke }));

import { SkillsHubError, skillsHubApi } from "./api";
import type { DiscoveredSkill } from "./types";

const discovered: DiscoveredSkill = {
  key: "anthropics/skills:alpha",
  name: "alpha",
  description: "managed skill",
  directory: "alpha",
  readmeUrl: null,
  repoOwner: "anthropics",
  repoName: "skills",
  repoBranch: "main",
};

describe("skills hub invoke args", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ ok: true });
  });

  it("splits the action from the payload for engine_skills_mutate", async () => {
    await skillsHubApi.setTargets("local:beta", ["claude"]);
    expect(invoke).toHaveBeenCalledWith("engine_skills_mutate", {
      action: "set_targets",
      payload: { id: "local:beta", targets: ["claude"] },
    });
  });

  it("keeps install's skill bag and force inside the payload", async () => {
    await skillsHubApi.install(discovered, ["claude", "codex"], true);
    expect(invoke).toHaveBeenCalledWith("engine_skills_mutate", {
      action: "install",
      payload: {
        force: true,
        skill: {
          name: "alpha",
          description: "managed skill",
          directory: "alpha",
          repoOwner: "anthropics",
          repoName: "skills",
          repoBranch: "main",
        },
        targets: ["claude", "codex"],
      },
    });
  });

  it("sends queries as mode + params, not as a mutation", async () => {
    await skillsHubApi.installed();
    expect(invoke).toHaveBeenCalledWith("engine_skills_query", {
      mode: "installed",
      params: {},
    });
  });

  it("normalizes backend { code, message } errors for callers that branch on code", async () => {
    invoke.mockRejectedValueOnce({ code: "conflict", message: "already managed" });
    const error = await skillsHubApi.uninstall("x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SkillsHubError);
    expect((error as SkillsHubError).code).toBe("conflict");
  });
});
