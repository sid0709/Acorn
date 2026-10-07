"use client";

import { useCallback } from "react";
import { Text, VStack, useToast } from "sid-ui";

export type Notice = { kind: "info" | "error"; title: string; detail?: string };

/** A toast with a bold title and an optional line under it. */
export function useNotice() {
  const toast = useToast();
  return useCallback(
    ({ kind, title, detail }: Notice) =>
      toast({
        type: kind,
        body: (
          <VStack gap={0.5}>
            <Text weight="semibold" color="inherit">
              {title}
            </Text>
            {detail ? (
              <Text type="supporting" color="inherit">
                {detail}
              </Text>
            ) : null}
          </VStack>
        ),
      }),
    [toast],
  );
}
