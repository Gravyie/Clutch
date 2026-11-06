"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Column counts by min-width, widest first. */
const DEFAULT_BREAKPOINTS: [number, number][] = [
  [1536, 4],
  [1024, 3],
  [640, 2],
  [0, 1],
];

function useColumns(breakpoints: [number, number][]) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const pick = () => setCols((breakpoints.find(([w]) => window.innerWidth >= w) ?? [0, 1])[1]);
    pick();
    window.addEventListener("resize", pick);
    return () => window.removeEventListener("resize", pick);
  }, [breakpoints]);
  return cols;
}

/**
 * Pinterest-style masonry that keeps reading order: each item goes into the currently shortest column (by an estimated
 * height), so the best-ranked items stay in the top row instead of running down the first column.
 */
export function Masonry<T>({
  items,
  estimate,
  render,
  getKey,
  breakpoints = DEFAULT_BREAKPOINTS,
  className,
}: {
  items: T[];
  /** relative height of an item at unit column width, e.g. 0.56 for a 16:9 picture plus its caption */
  estimate: (item: T) => number;
  render: (item: T) => React.ReactNode;
  getKey: (item: T) => string;
  breakpoints?: [number, number][];
  className?: string;
}) {
  const cols = useColumns(breakpoints);
  const columns: T[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  for (const item of items) {
    let i = 0;
    for (let c = 1; c < cols; c++) if (heights[c] < heights[i] - 0.01) i = c;
    columns[i].push(item);
    heights[i] += estimate(item);
  }
  return (
    <div className={cn("grid items-start gap-4", className)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-4">
          {col.map((item) => (
            <div key={getKey(item)}>{render(item)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
