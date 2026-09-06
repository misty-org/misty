import { compare } from "semver";
import type { OfficialApp } from "@/api/apps";
import { MINI_APP_PROTOCOL_VERSION } from "./miniAppProtocol";
import manifest from "../../../package.json";

export function assertAppCompatible(app: OfficialApp) {
  if (app.minimum_host_protocol > MINI_APP_PROTOCOL_VERSION ||
    (app.minimum_host_version && compare(manifest.version, app.minimum_host_version) < 0))
    throw new Error(`${app.name} needs Misty ${app.minimum_host_version ?? "with a newer app runtime"}. Update Misty first.`);
}
