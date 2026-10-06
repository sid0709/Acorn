"use client";

import { useEffect, useRef, useState } from "react";
import { previewResume } from "@/lib/resume/api";
import { withTemplate } from "@/lib/resume/design";
import type { ResumeGeneratorConfig } from "@acorn/shared/resume-config";
import type { ResumeIdentity } from "@acorn/shared/resume-content";
import { resumeSampleSections } from "@acorn/shared/resume-samples";
import { RESUME_TEMPLATES } from "@acorn/shared/resume-templates";

/**
 * Sample-filled HTML for every built-in template, rendered the way each looks once picked.
 * Loads only while `enabled`, one template at a time so the first tiles fill in quickly.
 */
export function useTemplateThumbs(
  enabled: boolean,
  identity: ResumeIdentity,
  config: ResumeGeneratorConfig,
): Record<string, string> {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const paper = config.theme.paper;
  const key = `${JSON.stringify(identity)}|${paper}`;
  const loadedKey = useRef("");

  useEffect(() => {
    if (!enabled || loadedKey.current === key) return;
    let cancel = false;
    const sections = resumeSampleSections(identity);
    void (async () => {
      for (const template of RESUME_TEMPLATES) {
        if (cancel) return;
        const result = await previewResume({
          identity,
          sections,
          config: withTemplate(config, template.id),
        });
        if (cancel) return;
        if (result.ok) setThumbs((current) => ({ ...current, [template.id]: result.data.html }));
      }
      loadedKey.current = key;
    })();
    return () => {
      cancel = true;
    };
    // Thumbnails follow the person and paper size, not every theme tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return thumbs;
}
