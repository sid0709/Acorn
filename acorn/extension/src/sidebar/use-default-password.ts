import { useEffect, useState } from "react";

import { fetchDefaultAccountPassword } from "../pipeline/api/profile";

/**
 * The profile's default account password while `show` is true (the run is on, or
 * stopped at, a site's account step), so the sidebar can say which one it used.
 * null while it loads or when not shown.
 */
export function useDefaultPassword(show: boolean): string | null {
  const [password, setPassword] = useState<string | null>(null);
  useEffect(() => {
    if (!show) {
      setPassword(null);
      return;
    }
    let live = true;
    fetchDefaultAccountPassword()
      .then((value) => {
        if (live) setPassword(value);
      })
      .catch((err: unknown) => {
        if (live)
          setPassword(`(could not read: ${err instanceof Error ? err.message : String(err)})`);
      });
    return () => {
      live = false;
    };
  }, [show]);
  return password;
}
