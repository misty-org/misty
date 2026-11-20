import { Text } from "@misty/ui";

export function LibraryMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text bare as="dt" tone="muted" className="text-3xs capitalize">
        {label}
      </Text>
      <Text bare as="dd" tone="muted" className="m-0 mt-1 break-words">
        {value || "—"}
      </Text>
    </div>
  );
}
