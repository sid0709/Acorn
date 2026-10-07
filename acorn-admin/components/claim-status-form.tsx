"use client";

import { useState } from "react";
import { Button, HStack, Text } from "sid-ui";

import { updateClaimStatusAction } from "@/lib/claims/actions";

const STATUSES = ["open", "triaged", "closed"] as const;

export function ClaimStatusForm({ id, status }: { id: string; status: string }) {
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  return (
    <HStack gap={2} align="center">
      <Text type="supporting">Status</Text>
      <select
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label="Claim status"
      >
        {STATUSES.map((row) => (
          <option key={row} value={row}>
            {row}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        label="Save"
        isDisabled={busy || value === status}
        onClick={() => {
          setBusy(true);
          void updateClaimStatusAction(id, value).finally(() => setBusy(false));
        }}
      />
    </HStack>
  );
}
