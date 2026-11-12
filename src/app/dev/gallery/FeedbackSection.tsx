import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Progress,
  Skeleton,
  SkeletonList,
  Spinner,
  notify,
  useNotice,
} from "@/shared/ui";
import { useState } from "react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

let sampleCount = 0;

export function FeedbackSection() {
  const [needsSignIn, setNeedsSignIn] = useState(false);
  useNotice(needsSignIn, {
    message: "Sign in to Todoist to continue",
    action: { label: "Sign in", onSelect: () => setNeedsSignIn(false) },
  });
  return (
    <GallerySection title="Notices and feedback">
      <GalleryRow label="notify">
        <Button onClick={() => notify({ message: "Chat moved to Archive" })}>Plain</Button>
        <Button
          onClick={() =>
            notify({
              message: "Chat moved to Archive",
              action: { label: "Undo", onSelect: () => notify({ message: "Chat restored" }) },
            })
          }
        >
          With an action
        </Button>
        <Button
          onClick={() =>
            notify({
              message: "Couldn't sync the Space. Check your connection.",
              tone: "error",
              id: "gallery-sync",
            })
          }
        >
          Error, one at a time
        </Button>
        <Button
          onClick={() => {
            sampleCount += 1;
            notify({ message: `Notice ${sampleCount}: at most three show at once` });
          }}
        >
          Stack another
        </Button>
      </GalleryRow>
      <GalleryRow label="useNotice">
        <Button onClick={() => setNeedsSignIn((value) => !value)}>
          {needsSignIn ? "Clear the condition" : "Hold a notice"}
        </Button>
      </GalleryRow>
      <GalleryRow label="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="count">3</Badge>
        <Badge variant="count">12</Badge>
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
        <SkeletonList label="Loading pages" className="w-72" />
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
    </GallerySection>
  );
}
