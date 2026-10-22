import type { OakFaceMode } from "@oak/face";

export const OAK_FACE_GUIDE: {
  mode: OakFaceMode;
  title: string;
  detail: string;
}[] = [
  { mode: "waiting", title: "Ready", detail: "Idle, watching your pages." },
  {
    mode: "thinking",
    title: "Reading",
    detail: "Analyzing the page or reading it for a job posting.",
  },
  { mode: "working", title: "Filling", detail: "Filling the form." },
  { mode: "sleeping", title: "Away", detail: "Signed out, AFK, or the tab is in the background." },
  { mode: "smile", title: "Done", detail: "A fill, a JD shot, or a copy just succeeded." },
  { mode: "wink", title: "Courtesy", detail: "Remembered a page, reconnected, or a small thanks." },
  { mode: "sad", title: "Stuck", detail: "An error or a skipped résumé." },
];
