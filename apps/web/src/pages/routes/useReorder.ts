import { useState, type DragEvent, type KeyboardEvent } from 'react';

/**
 * Reorders a list by dragging its rows, or from the keyboard: focus a row's
 * handle and press the up or down arrow. Each move is announced.
 */
export function useReorder<T>(items: T[], name: (item: T) => string, onMove: (next: T[]) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setAnnouncement(`${name(moved)} moved to position ${to + 1} of ${items.length}.`);
    onMove(next);
  };

  const rowProps = (index: number) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      setDragging(index);
      event.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (event: DragEvent) => {
      if (dragging !== null) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (dragging !== null) move(dragging, index);
      setDragging(null);
    },
    onDragEnd: () => setDragging(null),
    'data-dragging': dragging === index ? '' : undefined,
  });

  const handleProps = (index: number) => ({
    type: 'button' as const,
    'aria-label': `Move ${name(items[index])}. Use the up and down arrow keys.`,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(index, index - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(index, index + 1);
      }
    },
  });

  return { rowProps, handleProps, announcement };
}
