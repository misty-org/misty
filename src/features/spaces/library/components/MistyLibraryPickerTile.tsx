import type { SpaceLibraryItem } from "../../api/dto/entities";
import { OverflowFadeText, Pressable, Surface, Text, type PressableProps } from "@/shared/ui";
import { Check } from "lucide-react";
import { MistyLibraryPickerThumbnail } from "./MistyLibraryPickerThumbnail";

/** One Library item in the picker grid; a checkmark marks it chosen. */
export function MistyLibraryPickerTile({
  spaceId,
  item,
  selected,
  disabled,
  onToggle,
}: {
  spaceId: string;
  item: SpaceLibraryItem;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  // A bordered card that lifts under the pointer; the picked one keeps the stronger edge.
  const pressable: PressableProps = { disabled };
  return (
    <Surface
      as={Pressable}
      wash="card"
      {...pressable}
      tone="card"
      edge={selected ? "strong" : "hairline"}
      radius="lg"
      className="group relative flex flex-col items-stretch gap-0 overflow-hidden p-0 shadow-xs"
      aria-pressed={selected}
      onClick={onToggle}
    >
      <Surface
        as="span"
        tone="card"
        className="grid aspect-[4/3] w-full place-items-center overflow-hidden"
      >
        <MistyLibraryPickerThumbnail spaceId={spaceId} item={item} />
      </Surface>
      <span className="block min-w-0 px-2.5 py-2">
        <OverflowFadeText full className="text-xs font-medium">
          {item.display_name}
        </OverflowFadeText>
        <Text full tone="muted" weight="regular" className="mt-0.5 text-2xs">
          {item.file.original_filename}
        </Text>
      </span>
      {selected ? (
        <Surface
          as="span"
          tone="active"
          radius="md"
          className="absolute right-2 top-2 grid size-5 place-items-center shadow-xs"
        >
          <Text bare tone="bright" className="grid place-items-center">
            <Check />
          </Text>
        </Surface>
      ) : null}
    </Surface>
  );
}
