import type { Dispatch, FormEventHandler, SetStateAction } from "react";

export type LibraryTextDialogState = {
  kind: "rename-item" | "edit-tags";
  title: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel?: string;
  secondaryValue?: string;
  itemId?: string;
};

export type LibraryMetadataDialogAction =
  "" | "add_tags" | "remove_tags" | "set_date" | "set_location";

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
