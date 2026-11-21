import { useEffect, useRef, useState } from "react";
import { fileEvents, onFilesEvent, type FolderChange } from "@/features/files";
import { onDriveChanged } from "../drive";
import { messageOf } from "./format";
import { listPlace } from "./listFolder";
import { parentOf, placeKey, type FileItem, type FilesPlace } from "./model";

export type ColumnListing = { items: FileItem[] | null; error?: string };

/**
 * The listings of the folders the column view shows, read as columns appear and kept while they stay.
 * They are read again when `revision` moves (after Files changed something), when a watched disk folder
 * changes, or when a Space drive changes.
 */
export function useColumnListings(places: FilesPlace[], hidden: boolean, revision: number) {
  const [listings, setListings] = useState<Record<string, ColumnListing>>({});
  const [tick, setTick] = useState(0);
  const read = useRef(new Set<string>());
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const keys = places.map(placeKey);
  const keysKey = keys.join("\n");
  const placesRef = useRef(places);
  placesRef.current = places;

  // Everything is read afresh when the hidden names show or hide, or after a change, behind what shows.
  useEffect(() => {
    read.current = new Set();
  }, [hidden, revision]);

  useEffect(() => {
    let live = true;
    for (const place of placesRef.current) {
      const key = placeKey(place);
      if (read.current.has(key)) continue;
      read.current.add(key);
      setListings((now) => (now[key] ? now : { ...now, [key]: { items: null } }));
      void listPlace(place, hidden).then(
        (items) => live && setListings((now) => ({ ...now, [key]: { items } })),
        (cause) =>
          live && setListings((now) => ({ ...now, [key]: { items: null, error: messageOf(cause, "This folder couldn't open.") } })),
      );
    }
    return () => {
      live = false;
      // A read cut short is read again the next time.
      for (const key of keysKey.split("\n")) if (!listingsRef.current[key]?.items) read.current.delete(key);
    };
  }, [keysKey, hidden, revision, tick]);

  // A change in a folder a column shows reads that column again.
  useEffect(() => {
    const again = (key: string) => {
      read.current.delete(key);
      setTick((count) => count + 1);
    };
    const stopDisk = onFilesEvent<FolderChange>(fileEvents.changed, (change) => {
      for (const key of [`disk:${change.path}`, `disk:${parentOf(change.path)}`]) if (key in listingsRef.current) again(key);
    });
    const stopDrive = onDriveChanged((changed) => {
      for (const key of Object.keys(listingsRef.current)) if (key.startsWith(`drive:${changed.space_id}:`)) again(key);
    });
    return () => {
      stopDisk();
      stopDrive();
    };
  }, []);

  return keys.map((key) => listings[key] ?? { items: null });
}
