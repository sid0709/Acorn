import { useEffect, useState } from "react";

import { findAvailableUpdate, type AvailableUpdate } from "./latest-release";

/** A newer extension the site was deployed with, looked up once when the sidebar opens. */
export function useAvailableUpdate(): {
  update: AvailableUpdate | null;
  dismiss: () => void;
} {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    let live = true;
    void findAvailableUpdate().then((found) => {
      if (live) setUpdate(found);
    });
    return () => {
      live = false;
    };
  }, []);
  return { update, dismiss: () => setUpdate(null) };
}
