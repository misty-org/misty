import { MistyFilePicker } from "@/features/picker";
import { createOpenFolderCard } from "./createOpenFolderCard";
export const OpenFolderCard = createOpenFolderCard((props) => (
  <MistyFilePicker {...props} mode="folder" title="Open project folder" />
));
