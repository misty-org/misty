import {
  Avatar,
  AvatarFallback,
  Badge,
  Banner,
  BannerContent,
  BannerDescription,
  BannerIcon,
  BannerTitle,
  EmptyState,
  Progress,
  Skeleton,
  Spinner,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import { Info } from "lucide-react";
import { GalleryRow, GallerySection } from "./GalleryLayout";

export function FeedbackSection() {
  return (
    <GallerySection title="Display and feedback">
      <GalleryRow label="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        {(["neutral", "info", "success", "warning", "danger"] as const).map((status) => (
          <StatusBadge key={status} status={status} dot>
            {status}
          </StatusBadge>
        ))}
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
      <GalleryRow label="Tabs">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="shared">Shared</TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="pt-2 text-xs text-cream-muted">
            Tab content
          </TabsContent>
        </Tabs>
      </GalleryRow>
      <Banner variant="info" onDismiss={() => {}}>
        <BannerIcon>
          <Info />
        </BannerIcon>
        <BannerContent>
          <BannerTitle>Update ready</BannerTitle>
          <BannerDescription>Restart Misty to finish installing.</BannerDescription>
        </BannerContent>
      </Banner>
      <EmptyState title="Nothing here yet" description="Empty, error, and permission states share one layout." />
    </GallerySection>
  );
}
