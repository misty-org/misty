import {createSpaceLibraryItemsApi as createItems} from "./library-items-core";
import * as transfers from "./library-upload";
import type {SpaceRequest} from "./types";
export function createSpaceLibraryItemsApi(request:SpaceRequest) {return createItems(request,transfers);}
