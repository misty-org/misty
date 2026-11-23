import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AuthUser } from "../sessions/auth_session";
import type { SavedAccountSession } from "../sessions/account_vault";

export type SetUserState = Dispatch<SetStateAction<AuthUser | null>>;
export type SetAccounts = Dispatch<SetStateAction<SavedAccountSession[]>>;

export interface AccountStateSetters {
  setUserState: SetUserState;
  setAccounts: SetAccounts;
}

export interface AccountOperation {
  accountOperationActive: MutableRefObject<boolean>;
  beginAccountOperation: () => void;
  finishAccountOperation: () => void;
}
