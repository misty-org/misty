import type { Folder } from "lucide-react";

import type { AndroidLocalGrantRequest } from "../../interfaces/components/ExplorerSidebar";

export type QuickAccessItem = {
  label: string;
  icon: typeof Folder;
  path: string;
  grantRequest?: AndroidLocalGrantRequest;
};
