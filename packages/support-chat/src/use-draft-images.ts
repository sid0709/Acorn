import { useCallback, useEffect, useRef, useState } from "react";

import { acceptImages } from "./form";

/** An image waiting in the composer, with a local preview. */
export type DraftImage = { key: string; file: File; url: string };

let nextKey = 0;

/**
 * The images attached to the message being written. Previews are object URLs, released
 * when an image is removed, the draft is sent, or the composer goes away.
 */
export function useDraftImages() {
  const [images, setImages] = useState<DraftImage[]>([]);
  const live = useRef<DraftImage[]>([]);
  live.current = images;

  useEffect(
    () => () => {
      for (const image of live.current) URL.revokeObjectURL(image.url);
    },
    [],
  );

  /** Adds what fits and answers why the rest didn't, or "". */
  const add = useCallback((files: File[]): string => {
    const { accepted, problem } = acceptImages(files, live.current.length);
    if (accepted.length) {
      const added = accepted.map((file) => ({
        key: `draft-image-${(nextKey += 1)}`,
        file,
        url: URL.createObjectURL(file),
      }));
      setImages((current) => [...current, ...added]);
    }
    return problem;
  }, []);

  const remove = useCallback((key: string) => {
    setImages((current) => {
      const gone = current.find((image) => image.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((image) => image.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.url);
      return [];
    });
  }, []);

  return { images, add, remove, clear };
}
