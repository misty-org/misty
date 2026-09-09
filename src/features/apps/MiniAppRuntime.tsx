import { OfficialAppPackageHost, type MiniAppRuntimeProps } from "./OfficialAppPackageHost";

/**
 * Stable host abstraction for untrusted Misty Apps. Platform-specific asset
 * loading happens before this boundary; Apps see only the shared protocol.
 */
export function MiniAppRuntime(props: MiniAppRuntimeProps) {
  return <OfficialAppPackageHost {...props} />;
}
