import { MistyFilePicker } from "./FilePicker";
import { MistyPickerShell } from "./MistyPickerShell";
import type { MistyPickerProps } from "./mistyPickerOptions";
export type { MistyPickerSource } from "./mistyPickerOptions";

export function MistyPicker(props: MistyPickerProps) {
  return <MistyPickerShell {...props} FilePickerComponent={MistyFilePicker} />;
}
