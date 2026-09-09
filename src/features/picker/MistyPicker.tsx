import { MistyFilePicker } from "./FilePicker";
import { MistyPickerShell } from "./MistyPickerShell";
import type { MistyPickerProps } from "./model/interfaces/MistyPicker";
export type { MistyPickerProps, MistyPickerSource } from "./model/interfaces/MistyPicker";

export function MistyPicker(props: MistyPickerProps) {
  return <MistyPickerShell {...props} FilePickerComponent={MistyFilePicker} />;
}
