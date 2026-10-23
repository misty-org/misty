import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AuthUser } from "../authSession";
import type { SavedAccountSession } from "../store/accountVault";

export type SetUserState = Dispatch<SetStateAction<AuthUser | null>>;
export type SetAccounts = Dispatch<SetStateAction<SavedAccountSession[]>>;

/** The provider's React state setters, shared by every hook that changes identity. */
export interface AccountStateSetters {
  setUserState: SetUserState;
  setAccounts: SetAccounts;
}

/** Guards against overlapping account changes; see `useAccountOperation`. */
export interface AccountOperation {
  accountOperationActive: MutableRefObject<boolean>;
  beginAccountOperation: () => void;
  finishAccountOperation: () => void;
}
