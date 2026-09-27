import {
  Checkbox,
  Field,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/ui";
import { Bold, Grid2x2, Italic, List } from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function FormsSection() {
  const [name, setName] = useState("Quarterly plan");
  return (
    <GallerySection
      title="Forms"
      note="Field wires label, hint, and error to any single control. Stacked for text, inline for switches and selects."
    >
      <div className="grid max-w-md gap-4">
        <Field label="Name" hint="Shown in the sidebar and tab title.">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Folder" error="A folder with this name already exists.">
          <Input defaultValue="Projects" />
        </Field>
        <Field label="Notes">
          <Textarea placeholder="Optional" rows={3} />
        </Field>
        <Field label="Sync automatically" hint="Uploads changes as you save." layout="inline">
          <Switch defaultChecked />
        </Field>
        <Field label="Default view" layout="inline">
          <Select defaultValue="list">
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="list">List</SelectItem>
              <SelectItem value="grid">Grid</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <GalleryRow label="Choices">
        <Label className="flex items-center gap-2 text-cream">
          <Checkbox defaultChecked /> Checkbox
        </Label>
        <RadioGroup defaultValue="a" className="flex gap-4">
          <Label className="flex items-center gap-2 text-cream">
            <RadioGroupItem value="a" /> Option A
          </Label>
          <Label className="flex items-center gap-2 text-cream">
            <RadioGroupItem value="b" /> Option B
          </Label>
        </RadioGroup>
      </GalleryRow>
      <GalleryRow label="Slider">
        <Slider defaultValue={[40]} max={100} className="w-60" aria-label="Volume" />
      </GalleryRow>
      <GalleryRow label="Toggles">
        <Toggle aria-label="Bold">
          <Bold />
        </Toggle>
        <Toggle aria-label="Italic" defaultPressed>
          <Italic />
        </Toggle>
        <ToggleGroup type="single" defaultValue="list" variant="outline">
          <ToggleGroupItem value="list" aria-label="List view">
            <List />
          </ToggleGroupItem>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Grid2x2 />
          </ToggleGroupItem>
        </ToggleGroup>
      </GalleryRow>
    </GallerySection>
  );
}
