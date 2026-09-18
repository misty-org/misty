const drawingListChangedEvent = "misty:space-drawings-changed";
const realtimeDrawingEvent = "misty:space-drawing-event";

export function notifyDrawingListChanged(spaceId: string): void {
  window.dispatchEvent(new CustomEvent(drawingListChangedEvent, { detail: { spaceId } }));
}

export function subscribeToDrawingListChanges(spaceId: string, listener: () => void): () => void {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<{ spaceId?: string }>).detail;
    if (detail?.spaceId === spaceId) listener();
  };
  const handleRealtime = (event: Event) => {
    const detail = (event as CustomEvent<{ space_id?: string }>).detail;
    if (detail?.space_id === spaceId) listener();
  };
  window.addEventListener(drawingListChangedEvent, handle);
  window.addEventListener(realtimeDrawingEvent, handleRealtime);
  return () => {
    window.removeEventListener(drawingListChangedEvent, handle);
    window.removeEventListener(realtimeDrawingEvent, handleRealtime);
  };
}
