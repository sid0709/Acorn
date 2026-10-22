"use client";

import type { CompletedRun } from "@acorn/shared/runs";
import { useState } from "react";
import { Dialog, DialogHeader, Layout, LayoutContent, Text } from "sid-ui";

import { describeRun } from "@/lib/workspace/progress";
import { runScreenshotSrc } from "@/lib/workspace/run-screenshot-src";

const PREVIEW_DIALOG_WIDTH = 900;

/**
 * The sent application's screenshot as a small thumbnail; pressing it opens the whole page, which
 * scrolls in the dialog. A Run with no image (older Runs, or one past its retention) shows a dash.
 */
export function RunScreenshot({ run }: { run: CompletedRun }) {
  const [isOpen, setIsOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (run.screenshotAt <= 0 || failed) {
    return (
      <Text type="supporting" color="secondary">
        —
      </Text>
    );
  }
  const src = runScreenshotSrc(run.id);
  const job = describeRun(run);
  return (
    <>
      <button
        type="button"
        className="run-shot-thumb"
        aria-label={`Open the screenshot of ${job.title}`}
        onClick={() => setIsOpen(true)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, already compressed image from our own route */}
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </button>
      <Dialog isOpen={isOpen} onOpenChange={setIsOpen} purpose="info" width={PREVIEW_DIALOG_WIDTH}>
        <Layout
          height="auto"
          header={
            <DialogHeader
              title={job.title}
              subtitle={job.where || "Page as it was when you pressed Sent"}
              onOpenChange={() => setIsOpen(false)}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <div className="run-shot-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- see the thumbnail */}
                <img src={src} alt={`Screenshot of ${job.title} when it was sent`} />
              </div>
            </LayoutContent>
          }
        />
      </Dialog>
    </>
  );
}
