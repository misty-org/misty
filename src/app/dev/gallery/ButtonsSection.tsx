import { Button, IconButton, Toolbar, ToolbarGroup, toolbarIconProps } from "@/shared/ui";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Download,
  MoreVertical,
  Pencil,
  Plus,
  RotateCw,
  Star,
} from "lucide-react";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

const variants = ["default", "secondary", "outline", "ghost", "toolbar", "pill", "link"] as const;

export function ButtonsSection() {
  const [starred, setStarred] = useState(false);
  return (
    <GallerySection
      title="Buttons"
      note="IconButton defaults to the browser toolbar look at 30px. Toolbars use the browser's 44px bar and 4px rhythm."
    >
      <GalleryRow label="Button variants">
        {variants.map((variant) => (
          <Button key={variant} variant={variant} size="sm">
            {variant}
          </Button>
        ))}
      </GalleryRow>
      <GalleryRow label="Button sizes">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">
          <Plus /> Large
        </Button>
        <Button disabled>Disabled</Button>
      </GalleryRow>
      <GalleryRow label="IconButton sizes">
        {(["xs", "sm", "md", "lg"] as const).map((size) => (
          <IconButton key={size} size={size} label={`Download (${size})`}>
            <Download />
          </IconButton>
        ))}
      </GalleryRow>
      <GalleryRow label="IconButton states">
        <IconButton
          label={starred ? "Remove star" : "Star"}
          aria-pressed={starred}
          onClick={() => setStarred((value) => !value)}
        >
          <Star fill={starred ? "currentColor" : "none"} />
        </IconButton>
        <IconButton label="Edit" variant="outline">
          <Pencil />
        </IconButton>
        <IconButton label="Unavailable" disabled>
          <Bookmark />
        </IconButton>
      </GalleryRow>
      <GalleryRow label="Toolbar">
        <Toolbar label="Example toolbar" className="w-full rounded-md border">
          <ToolbarGroup>
            <IconButton label="Back">
              <ArrowLeft {...toolbarIconProps} />
            </IconButton>
            <IconButton label="Forward" disabled>
              <ArrowRight {...toolbarIconProps} />
            </IconButton>
            <IconButton label="Reload">
              <RotateCw {...toolbarIconProps} />
            </IconButton>
          </ToolbarGroup>
          <ToolbarGroup align="end">
            <IconButton label="Bookmark">
              <Star {...toolbarIconProps} />
            </IconButton>
            <IconButton label="More">
              <MoreVertical {...toolbarIconProps} />
            </IconButton>
          </ToolbarGroup>
        </Toolbar>
      </GalleryRow>
    </GallerySection>
  );
}
