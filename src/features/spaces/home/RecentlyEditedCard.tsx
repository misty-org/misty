import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { OverflowFadeText } from "@/shared/ui";
import { kindIcon } from "./GalleryPreview";
import { editedLabel, type GalleryItem } from "./galleryItems";
import { OverviewCard, OverviewEmpty, OverviewRow, OverviewRowsSkeleton } from "./OverviewCard";
import { useNow } from "@/shared/hooks/useNow";

const shown = 5;

/**
 * The Space's docs, drawings and files edited last, beside its project folders. Chats have their
 * own panel.
 */
export function RecentlyEditedCard(props: { items: GalleryItem[]; loading: boolean }) {
  const now = useNow();
  const navigate = useNavigate();
  const recent = useMemo(
    () =>
      props.items
        .filter((item) => item.kind !== "chat")
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, shown),
    [props.items],
  );
  return (
    <OverviewCard title="Recently edited">
      {props.loading && !recent.length ? (
        <OverviewRowsSkeleton rows={3} kind="folder" />
      ) : recent.length ? (
        recent.map((item) => {
          const { Icon, label } = kindIcon[item.kind];
          return (
            <OverviewRow
              key={item.key}
              kind="folder"
              leading={<Icon aria-hidden />}
              title={item.title}
              detail={<OverflowFadeText full>{label}</OverflowFadeText>}
              trailing={editedLabel(item.updatedAt, now)}
              onOpen={() => navigate(item.href)}
            />
          );
        })
      ) : (
        <OverviewEmpty>Nothing edited yet</OverviewEmpty>
      )}
    </OverviewCard>
  );
}
