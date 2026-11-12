import {
  Button,
  Checkbox,
  Field,
  FieldError,
  Input,
  Label,
  OptionSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
} from "@/shared/ui";
import { LayoutGrid, List, Rows3 } from "lucide-react";
import { useId, useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const takenNames = new Set(["projects", "notes"]);

function nameError(name: string) {
  if (!name.trim()) return "Give the folder a name.";
  if (takenNames.has(name.trim().toLowerCase())) return "A folder with this name already exists.";
  return "";
}

export function FormsSection() {
  const [name, setName] = useState("Projects");
  const [error, setError] = useState(nameError("Projects"));
  const [layout, setLayout] = useState("list");
  const [sync, setSync] = useState(true);
  const customErrorId = useId();
  return (
    <GallerySection title="Forms">
      <form
        className="grid max-w-md gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(nameError(name));
        }}
      >
        <Field label="Folder name" error={error}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
        </Field>
        <Field label="Notes">
          <Textarea placeholder="Optional" rows={3} />
        </Field>
        <Field label="Sync automatically" layout="inline">
          <Switch checked={sync} onCheckedChange={setSync} />
        </Field>
        <Field label="Default view" layout="inline">
          <Select value={layout} onValueChange={setLayout}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="list" icon={List} label="List" />
              <SelectItem value="grid" icon={LayoutGrid} label="Grid" />
              <SelectItem value="rows" icon={Rows3} label="Rows" disabled reason="Coming later" />
            </SelectContent>
          </Select>
        </Field>
        <Field label="Layout, as OptionSelect" layout="inline">
          <OptionSelect
            value={layout}
            onValueChange={setLayout}
            options={[
              { value: "list", label: "List", icon: List },
              { value: "grid", label: "Grid", icon: LayoutGrid },
            ]}
          />
        </Field>
        <div className="grid gap-1">
          <Label htmlFor={`${customErrorId}-input`}>Custom control with FieldError</Label>
          <Input
            id={`${customErrorId}-input`}
            defaultValue="not an address"
            aria-invalid
            aria-describedby={customErrorId}
          />
          <FieldError id={customErrorId} message="Enter an address like name@example.com." />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Create folder
          </Button>
        </div>
      </form>
      <GalleryRow label="Checkbox">
        <Label className="flex items-center gap-2">
          <Checkbox defaultChecked /> Include subfolders
        </Label>
        <Label className="flex items-center gap-2">
          <Checkbox disabled /> Unavailable
        </Label>
      </GalleryRow>
      <GalleryRow label="Slider">
        <Slider defaultValue={[40]} max={100} className="w-60" aria-label="Volume" />
      </GalleryRow>
    </GallerySection>
  );
}
