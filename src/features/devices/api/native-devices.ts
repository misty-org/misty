import { invoke } from "../../../native/invoke";

// This computer's identity for agent runs. Its key, signatures and job checks stay native; these
// only ask for them.

interface SignedRecord {
  payload: string;
  signature: string;
}

export const devicesNative = {
  /** Grants from this computer to itself. They need no account. */
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
  /** A shared folder's file for a `folder.send` job, checked against the job's
   * run grant natively. Arrives as raw bytes (at most 128 MiB). */
  readSharedFile: (scopeId: string, input: unknown, config: unknown) =>
    invoke<ArrayBuffer>("device_read_shared_file", { scopeId, input, config }),
};
