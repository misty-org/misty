import {
  Avatar,
  AvatarFallback,
  Badge,
  EmptyState,
  Progress,
  Skeleton,
  Spinner,
} from "@/shared/ui";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function FeedbackSection() {
  return (
    <GallerySection title="Display and feedback">
      <GalleryRow label="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
      </GalleryRow>
      <GalleryRow label="Progress">
        <Progress value={62} className="w-60" aria-label="Upload progress" />
        <Spinner size="sm" />
        <Spinner />
        <Spinner size="lg" />
      </GalleryRow>
      <GalleryRow label="Skeleton">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="size-8 rounded-full" />
      </GalleryRow>
      <GalleryRow label="Avatars">
        <Avatar size="sm">
          <AvatarFallback>MT</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>MT</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>MT</AvatarFallback>
        </Avatar>
      </GalleryRow>
      <EmptyState
        title="Nothing here yet"
        description="Empty, error, and permission states share one layout."
      />
    </GallerySection>
  );
}
