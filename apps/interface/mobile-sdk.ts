/**
 * @deprecated Import from @misty/sdk. Mobile and desktop Apps now use the
 * same credential-free, transport-agnostic capability client.
 */
export {
  MISTY_APP_PROTOCOL_VERSION,
  connectMistyApp as connectHostedMistyApp,
  defineApp,
  readMistyAppRuntimeIdentity,
} from "./sdk";
export type {
  MistyAppContext,
  MistyAppDefinition,
  MistyAppRuntimeIdentity,
  MistyAppSDK as MistyHostedAppSDK,
  MistyNavigationItem,
  MistyStorageArea,
} from "./sdk";
