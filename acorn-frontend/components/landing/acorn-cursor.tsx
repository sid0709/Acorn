"use client";

import { useEffect, useRef } from "react";
import { startCursorFx } from "./acorn-cursor-fx";

/** The landing root, and the class that turns the native cursor off inside it. */
const ROOT_SELECTOR = ".ac";
const ROOT_ACTIVE_CLASS = "ac-cursor-on";
/** Only a mouse gets it: a touch screen has no cursor, and a person who asked for less motion keeps theirs. */
const MOUSE_ONLY = "(hover: hover) and (pointer: fine)";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** The glowing acorn that follows the mouse over the home page, with its sparkles. Decoration only. */
export function AcornCursor() {
  const cursor = useRef<HTMLDivElement>(null);
  const rotator = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = cursor.current?.closest<HTMLElement>(ROOT_SELECTOR);
    if (!root || !cursor.current || !rotator.current || !canvas.current) return;
    if (!window.matchMedia(MOUSE_ONLY).matches || window.matchMedia(REDUCED_MOTION).matches) return;
    root.classList.add(ROOT_ACTIVE_CLASS);
    const stop = startCursorFx({
      cursor: cursor.current,
      rotator: rotator.current,
      canvas: canvas.current,
    });
    return () => {
      stop();
      root.classList.remove(ROOT_ACTIVE_CLASS);
    };
  }, []);

  return (
    <div aria-hidden="true">
      <canvas ref={canvas} className="ac-fx-canvas" />
      <div ref={cursor} className="ac-cursor">
        <div ref={rotator} className="ac-cursor-rotator">
          <div className="ac-cursor-aura" />
          <svg className="ac-cursor-svg" viewBox="0 0 100 100" fill="none" focusable="false">
            <defs>
              <linearGradient id="ac-cursor-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="35%" stopColor="#ffe37a" />
                <stop offset="85%" stopColor="#ff9000" />
                <stop offset="100%" stopColor="#ff4800" />
              </linearGradient>
              <linearGradient id="ac-cursor-inner" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ffa500" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            <path
              d="M 50 14 C 62 14, 76 36, 83 62 C 89 82, 79 88, 66 84 C 56 80, 53 66, 50 66 C 47 66, 44 80, 34 84 C 21 88, 11 82, 17 62 C 24 36, 38 14, 50 14 Z"
              stroke="url(#ac-cursor-grad)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#ac-cursor-inner)"
            />
            <path
              d="M 39 63 C 44 51, 56 51, 61 63"
              stroke="url(#ac-cursor-grad)"
              strokeWidth="6.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
