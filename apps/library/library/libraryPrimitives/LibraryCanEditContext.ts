import { createContext } from "react";

/**
 * Whether the viewer may edit this Space's Library.
 *
 * Provided once at the Library root so deeply nested tiles can hide their pin
 * and reorder affordances without every level passing the flag down.
 */
export const LibraryCanEditContext = createContext(true);
