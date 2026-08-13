export const PROJECT_VIRTUALIZATION_THRESHOLD = 80;

export interface VirtualRangeInput {
  itemCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}

export interface VirtualRange {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  offsetBottom: number;
}

/**
 * Calculates a bounded half-open range for a fixed-height project list.
 * The function is deliberately independent from React so the 500-project
 * performance contract can be covered by a fast unit test.
 */
export function calculateVirtualRange({
  itemCount,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 6
}: VirtualRangeInput): VirtualRange {
  const count = Math.max(0, Math.floor(itemCount));
  const height = Math.max(1, rowHeight);
  if (count === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, offsetBottom: 0 };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(height, viewportHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const firstVisible = Math.floor(safeScrollTop / height);
  const lastVisible = Math.ceil((safeScrollTop + safeViewportHeight) / height);
  const startIndex = Math.max(0, Math.min(count, firstVisible - safeOverscan));
  const endIndex = Math.max(startIndex, Math.min(count, lastVisible + safeOverscan));

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * height,
    offsetBottom: Math.max(0, (count - endIndex) * height)
  };
}
