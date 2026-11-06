import { Captions } from "lucide-react";
import { DropdownMenuCheckboxItem } from "@/shared/ui";
import { useSubtitlesStore } from "./useSubtitlesStore";

/** Opens and closes the floating subtitles panel from the browser's More tools. */
export function LiveSubtitlesMenuItem(props: { onError: (error: unknown) => void }) {
  const on = useSubtitlesStore((state) => state.on);
  return (
    <DropdownMenuCheckboxItem
      checked={on}
      onCheckedChange={(checked) => {
        const { open, close } = useSubtitlesStore.getState();
        void (checked === true ? open() : close()).catch(props.onError);
      }}
    >
      <Captions />
      <span className="min-w-0 flex-1 truncate">Live subtitles</span>
    </DropdownMenuCheckboxItem>
  );
}
