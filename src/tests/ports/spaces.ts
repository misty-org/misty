import { spacesDirectory } from "@/features/app-windows";
import { useSpacesStore } from "@/features/spaces/list/use_spaces_store";

spacesDirectory.provide(useSpacesStore);
