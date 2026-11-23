import { MistyFilePicker } from "./FilePicker";
import { MistyPickerShell } from "./MistyPickerShell";
import type { MistyPickerProps } from "./misty_picker_options";
export type { MistyPickerSource } from "./misty_picker_options";

export function MistyPicker(props: MistyPickerProps) {
  return <MistyPickerShell {...props} FilePickerComponent={MistyFilePicker} />;
}
