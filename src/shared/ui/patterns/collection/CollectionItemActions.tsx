import { RowActions } from "../../overlays/RowActions";
import {
  hasItemActions,
  itemMenuLabel,
  itemMenuOpened,
  type CollectionItem,
} from "./collectionItemTypes";

/**
 * An item's one place for its actions, last inside a row or card that carries `group/row`: the
 * ⋯ of its `menu`, which also opens on a right-click anywhere on the row.
 */
export function CollectionItemActions({
  item,
  className,
}: {
  item: CollectionItem;
  className?: string;
}) {
  if (!hasItemActions(item)) return null;
  return (
    <RowActions
      label={itemMenuLabel(item)}
      onOpenChange={itemMenuOpened(item)}
      className={className}
    >
      {item.menu}
    </RowActions>
  );
}
