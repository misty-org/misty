import { describe, expect, it } from "vitest";
import type { ProviderWorkflow } from "../../api/types";
import { providerOptionsForConnection } from "./providerUtils";

const noisyRcloneDriveWorkflow: ProviderWorkflow = {
  type: "drive",
  name: "Google Drive",
  description: "Google Drive",
  options: [
    { name: "client_id", label: "Client ID", help: "", defaultValue: "", required: false, password: false, choices: [] },
    { name: "client_secret", label: "Client Secret", help: "", defaultValue: "", required: false, password: true, choices: [] },
    { name: "token", label: "Token", help: "", defaultValue: "", required: false, password: true, choices: [] },
    { name: "scope", label: "Scope", help: "", defaultValue: "drive", required: false, password: false, choices: [] },
    { name: "chunk_size", label: "Chunk size", help: "", defaultValue: "8Mi", required: false, password: false, choices: [] },
  ],
};

describe("providerOptionsForConnection", () => {
  it("shows only optional OAuth application credentials for a new Google Drive connection", () => {
    const options = providerOptionsForConnection(
      { mode: "add", providerType: "drive", parameters: {}, step: null },
      noisyRcloneDriveWorkflow,
    );

    expect(options.map((option) => option.name)).toEqual(["client_id", "client_secret"]);
    expect(options.some((option) => option.name === "token")).toBe(false);
  });

  it("still displays an explicit rclone state-machine question", () => {
    const option = {
      name: "config_is_local",
      label: "Use browser",
      help: "",
      defaultValue: "true",
      required: true,
      password: false,
      choices: [{ value: "true", help: "Yes" }, { value: "false", help: "No" }],
    };
    const options = providerOptionsForConnection(
      { mode: "add", providerType: "drive", parameters: {}, step: { kind: "post_auth_config", name: "", state: "state", result: "", done: false, instructions: "", authorizeUrl: "", option, error: "", pollAfterMs: 0 } },
      noisyRcloneDriveWorkflow,
    );

    expect(options).toEqual([option]);
  });
});
