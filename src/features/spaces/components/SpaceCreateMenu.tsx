import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  MenuTrigger,
} from "@/shared/ui";
import { CheckSquare, Notebook, Plus, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSpacesStore } from "../store/useSpacesStore";

export function SpaceCreateMenu({
  space,
  sidebar = false,
  onNavigate,
}: {
  space: Space;
  sidebar?: boolean;
  onNavigate?: (path: string) => void;
}) {
  const routerNavigate = useNavigate();
  const navigate = onNavigate ?? routerNavigate;
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  if (referenceOnly) return null;
  const base = `/spaces/${encodeURIComponent(space.id)}`;
  return (
    <DropdownMenu>
      {sidebar ? (
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" justify="start" className="w-full">
            <Plus />
            New item
          </Button>
        </DropdownMenuTrigger>
      ) : (
        <MenuTrigger label="New" variant="primary" className="px-4" />
      )}
      <DropdownMenuContent align={sidebar ? "start" : "end"}>
        <MenuItem
          icon={<Notebook />}
          label="Note"
          onSelect={() => navigate(`${base}/notes?create=note`)}
        />
        {(space.role === "owner" || space.permissions?.["tasks.manage"] === true) &&
          space.permissions?.["tasks.view"] !== false && (
            <MenuItem
              icon={<CheckSquare />}
              label="Task"
              onSelect={() => navigate(`${base}/planner/tasks/list?create=task`)}
            />
          )}
        {space.permissions?.["library.view"] !== false &&
          space.permissions?.["library.upload"] !== false && (
            <MenuItem
              icon={<Upload />}
              label="Upload file"
              onSelect={() => navigate(`${base}/library?upload=1`)}
            />
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
