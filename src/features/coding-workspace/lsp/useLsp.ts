import { createCodeLspRegistry } from "./registry";
import { nativeCodeLspTransport } from "./nativeTransport";
export { languageFor } from "./language";
const registry = createCodeLspRegistry(nativeCodeLspTransport);
export const getLspClient = registry.get;
export const lastLspError = registry.error;
export const forgetLspError = registry.forgetError;
export const retainLspRoot = registry.retainRoot;
