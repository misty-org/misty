export type CurrentUser = {
  id: string;
  username: string;
  email: string;
};

export type NativeSession = {
  current_user: CurrentUser | null;
};
