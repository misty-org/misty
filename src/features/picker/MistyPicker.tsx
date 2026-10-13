import { MistyFilePicker } from "./FilePicker";
import { MistyPickerShell } from "./MistyPickerShell";
import type { MistyPickerProps } from "./model/MistyPicker";
export type { MistyPickerProps, MistyPickerSource } from "./model/MistyPicker";

export function MistyPicker(props: MistyPickerProps) {
  return <MistyPickerShell {...props} FilePickerComponent={MistyFilePicker} />;
}
