"use client";

import { Banner, Button } from "sid-ui";

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Banner
      status="error"
      title="This page could not load"
      description={error.message || "acorn-backend did not answer."}
      endContent={<Button label="Try again" variant="secondary" onClick={reset} />}
    />
  );
}
