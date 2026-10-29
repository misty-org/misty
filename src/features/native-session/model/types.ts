export type CurrentUser = {
  id: string;
  username: string;
  email: string;
};

/** The account this device last signed in with, as recorded by the native app. */
export type NativeSession = {
  current_user: CurrentUser | null;
};
