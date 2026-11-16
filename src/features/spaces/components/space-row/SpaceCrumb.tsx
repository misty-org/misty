import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, OverflowFadeText, Text } from "@/shared/ui";
import { useSpacesStore } from "../../list/useSpacesStore";
import { SpaceAvatar } from "../SpaceAvatar";

/**
 * A page of a Space as its bar's title: the Space's mark and name, which go back to its home,
 * then the page's own name.
 */
export function SpaceCrumb({ spaceId, here }: { spaceId: string; here: string }) {
  const navigate = useNavigate();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  // The Space's mark, as the Space switcher shows it.
  const mark = space ? (
    <SpaceAvatar
      space={space}
      className="size-5 rounded-md"
      fallbackClassName="text-3xs font-semibold"
    />
  ) : null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {space ? (
        <Button
          variant="quiet"
          snug
          aria-label={`${space.name} home`}
          icon={mark}
          onClick={() => navigate(`/spaces/${encodeURIComponent(spaceId)}`)}
        >
          <OverflowFadeText full>{space.name}</OverflowFadeText>
        </Button>
      ) : null}
      {space ? (
        <Text bare tone="muted" className="inline-flex shrink-0" aria-hidden>
          <ChevronRight />
        </Text>
      ) : null}
      <Text as="h1" bare size="control" weight="semibold" tone="bright" className="shrink-0">
        {here}
      </Text>
    </span>
  );
}
