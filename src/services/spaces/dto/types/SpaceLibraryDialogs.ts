import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import type { SpaceLibraryItem } from "../interfaces/types";

export type LibraryTextDialogState = {
  kind: "create-folder" | "rename-folder" | "rename-memory" | "rename-item" | "edit-tags";
  title: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  itemId?: string;
};

export type LibraryMetadataDialogAction =
  "" | "add_tags" | "remove_tags" | "set_date" | "set_location";

export type LibraryAlbumDialogMode = "" | "create" | "edit";

export type LibraryPersonDialogMode = "" | "create" | "edit";

export type LibraryUnlockScope = "" | "hidden" | "recently_deleted";

export type AlbumDialogModel = {
  mode: LibraryAlbumDialogMode;
  name: string;
  description: string;
  coverItemId: string;
  saving: boolean;
  items: SpaceLibraryItem[];
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setCoverItemId: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

export type PersonDialogModel = {
  mode: LibraryPersonDialogMode;
  kind: "person" | "pet";
  name: string;
  coverItemId: string;
  saving: boolean;
  items: SpaceLibraryItem[];
  setName: (value: string) => void;
  setCoverItemId: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

export type MetadataDialogModel = {
  action: LibraryMetadataDialogAction;
  selectedCount: number;
  tags: string;
  date: string;
  locationName: string;
  latitude: string;
  longitude: string;
  saving: boolean;
  setTags: (value: string) => void;
  setDate: (value: string) => void;
  setLocationName: (value: string) => void;
  setLatitude: (value: string) => void;
  setLongitude: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

export type TextDialogModel = {
  state: LibraryTextDialogState | null;
  saving: boolean;
  error: string;
  setState: Dispatch<SetStateAction<LibraryTextDialogState | null>>;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};

export type UnlockDialogModel = {
  scope: LibraryUnlockScope;
  password: string;
  saving: boolean;
  error: string;
  setPassword: (value: string) => void;
  close: () => void;
  submit: FormEventHandler<HTMLFormElement>;
};
