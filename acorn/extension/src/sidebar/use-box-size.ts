import { useEffect, useState, type RefObject } from "react";

/** An element's laid-out size (CSS pixels), kept as the panel is resized. Zero until it is laid out. */
export function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, [ref]);
  return size;
}
