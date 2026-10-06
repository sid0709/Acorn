"use client";

import { useEffect } from "react";
import { loadProfile } from "@/lib/profile/api";
import { readWorkspaceSnapshot, writeWorkspace } from "@/lib/workspace/model";
import { withDefaults } from "@/lib/workspace/profile";

/** Copies the account profile into this browser so the résumé editor can read it. */
export function ProfileSync() {
  useEffect(() => {
    let cancelled = false;
    void loadProfile().then((result) => {
      if (cancelled || !result.ok || !result.data.stored) return;
      const current = readWorkspaceSnapshot();
      writeWorkspace({ ...current, profile: withDefaults(result.data.profile) });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
