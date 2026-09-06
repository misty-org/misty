import {
  AllItemsDestinationIcon,
  FavoritesDestinationIcon,
  CollectionsDestinationIcon,
  AlbumsDestinationIcon,
  DeletedDestinationIcon,
} from "./NavigatorDestinationIcons";
import { InstagramBrandIcon } from "@/features/spaces/social/InstagramBrandIcon";
import { MessengerBrandIcon, XBrandIcon } from "@/features/spaces/social/SocialProviderBrandIcons";
import { MistyBrandIcon } from "@/features/workspace/MistyBrandIcon";
import { SiDiscord } from "react-icons/si";
import { BotMessageSquare, Workflow } from "lucide-react";
import type { MistyNavigationItem } from "@misty/sdk";
import { FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import {
  WorkspaceAppIcon,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type NavigatorAppId,
} from "@/features/workspace";
import { useNavigatorDisclosureState } from "./useNavigatorDisclosureState";

export function DownloadedAppNavigator(props: {
  accountId: string;
  appId: NavigatorAppId;
  label: string;
  active: boolean;
  activeRoute: string;
  items: readonly MistyNavigationItem[];
}) {
  const [open, setOpen] = useNavigatorDisclosureState(props.accountId, props.appId, props.active);
  useEffect(() => {
    if (props.active) setOpen(true);
  }, [props.active, setOpen]);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={navigationMenuGroupClass}
      data-navigator-disclosure={props.appId}
    >
      <CollapsibleTrigger asChild>
        <NavigationSectionButton
          icon={<WorkspaceAppIcon appId={props.appId} size="nav" />}
          label={props.label}
          open={open}
          aria-label={props.label}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <AppItems
          appId={props.appId}
          items={props.items}
          activeRoute={props.active ? props.activeRoute : ""}
          label={`${props.label} destinations`}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

function sameRoute(left: string, right: string) {
  if (!right) return false;
  const normalize = (route: string) => {
    const url = new URL(route, "https://misty.local");
    url.searchParams.sort();
    return `${url.pathname}${url.search}${url.hash}`;
  };
  return normalize(left) === normalize(right);
}
function AppItems(props: {
  appId: NavigatorAppId;
  items: readonly MistyNavigationItem[];
  activeRoute: string;
  label: string;
}) {
  return (
    <div className={navigationMenuGroupClass} role="group" aria-label={props.label}>
      {props.items.map((item, index) => (
        <div key={item.id} className={navigationMenuGroupClass}>
          <NavigationTreeItem
            asChild
            icon={<DestinationIcon appId={props.appId} item={item} />}
            label={item.label}
            selected={sameRoute(item.route, props.activeRoute)}
            last={index === props.items.length - 1}
          >
            <Link
              to={item.route}
              onClick={() => {
                const surface = workspaceSurfaceFromRoute(item.route);
                if (surface) useWorkspaceStore.getState().openSurface(surface);
              }}
            />
          </NavigationTreeItem>
          {item.children?.length ? (
            <div className="ml-[27px]">
              <AppItems
                appId={props.appId}
                items={item.children}
                activeRoute={props.activeRoute}
                label={`${item.label} destinations`}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DestinationIcon({ appId, item }: { appId: NavigatorAppId; item: MistyNavigationItem }) {
  if (appId === "social") {
    const provider =
      new URL(item.route, "https://misty.local").searchParams.get("provider") ?? item.id;
    if (provider === "misty") return <MistyBrandIcon size={18} />;
    const Icon = {
      instagram: InstagramBrandIcon,
      messenger: MessengerBrandIcon,
      x: XBrandIcon,
      discord: SiDiscord,
    }[provider];
    if (Icon) return <Icon aria-hidden />;
  }
  if (appId === "library") {
    const Icon = {
      recent: AllItemsDestinationIcon,
      favorites: FavoritesDestinationIcon,
      collections: CollectionsDestinationIcon,
      albums: AlbumsDestinationIcon,
      deleted: DeletedDestinationIcon,
    }[item.id];
    if (Icon) return <Icon aria-hidden />;
  }
  if (appId === "agents") {
    const Icon = item.id === "automations" ? Workflow : BotMessageSquare;
    return <Icon aria-hidden />;
  }
  return <FileText aria-hidden />;
}
