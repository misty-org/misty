import { invoke } from "../../../native/invoke";

interface SignedRecord {
  payload: string;
  signature: string;
}

export const devicesNative = {
  signRunGrants: (
    grants: {
      agentId?: string;
      chatKey?: string;
      capabilities: string[];
      scopes: string[];
    }[],
  ) => invoke<SignedRecord[]>("device_sign_run_grants", { grants }),
  verifyJob: (operation: string, scopeId: string, config: unknown) =>
    invoke<void>("device_verify_job", { operation, scopeId, config }),
  readSharedFile: (scopeId: string, input: unknown, config: unknown) =>
    invoke<ArrayBuffer>("device_read_shared_file", { scopeId, input, config }),
};
