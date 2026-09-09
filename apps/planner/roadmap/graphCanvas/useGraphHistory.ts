import type { Node } from "@xyflow/react";
import { useCallback, useRef } from "react";

function cloneGraphNodes<T extends Node>(nodes: T[]): T[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    style: node.style ? { ...node.style } : undefined,
    data: { ...node.data },
  }));
}

export function useGraphHistory<T extends Node>() {
  const undoRef = useRef<T[][]>([]);
  const redoRef = useRef<T[][]>([]);

  const capture = useCallback((nodes: T[]) => {
    undoRef.current.push(cloneGraphNodes(nodes));
    if (undoRef.current.length > 100) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  const undo = useCallback((nodes: T[]) => {
    const previous = undoRef.current.pop();
    if (!previous) return undefined;
    redoRef.current.push(cloneGraphNodes(nodes));
    return previous;
  }, []);

  const redo = useCallback((nodes: T[]) => {
    const next = redoRef.current.pop();
    if (!next) return undefined;
    undoRef.current.push(cloneGraphNodes(nodes));
    return next;
  }, []);

  const reset = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
  }, []);

  return {
    capture,
    undo,
    redo,
    reset,
    canUndo: () => undoRef.current.length > 0,
    canRedo: () => redoRef.current.length > 0,
  };
}

export { cloneGraphNodes };
