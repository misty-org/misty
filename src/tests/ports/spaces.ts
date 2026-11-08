import { spacesDirectory } from "@/features/app-windows";
import { useSpacesStore } from "@/features/spaces/list/useSpacesStore";

// Spaces fills this in at startup (src/app/featureSeams.ts); tests of lower features do it here.
spacesDirectory.provide(useSpacesStore);
