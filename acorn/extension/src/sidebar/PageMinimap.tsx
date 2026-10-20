import { useEffect, useRef } from "react";

import { drawPageMinimap, minimapLabel } from "./page-minimap";

import type { RunMap } from "@acorn/shared/run-types";

/**
 * The page an agent Run is on, as a minimap: the parts the model settled are painted, and the box is
 * where the window is. It lives here, in the Now card, and not on the page the person is reading.
 */
export function PageMinimap({ map }: { map: RunMap }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawPageMinimap(canvas.current, map);
  }, [map]);
  return (
    <canvas ref={canvas} className="acorn-minimap" role="img" aria-label={minimapLabel(map)} />
  );
}
