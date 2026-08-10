import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@/shared/ui";
import { CheckSquare, ChevronDown, Notebook, Plus, Upload } from "lucide-react";
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
      <DropdownMenuTrigger asChild>
        <Button
          variant={sidebar ? "outline" : "primary"}
          size="sm"
          justify={sidebar ? "start" : "center"}
          className={sidebar ? "w-full" : "px-4"}
        >
          {sidebar ? <Plus /> : null}
          {sidebar ? "New item" : "New"}
          {!sidebar && <ChevronDown />}
        </Button>
      </DropdownMenuTrigger>
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
