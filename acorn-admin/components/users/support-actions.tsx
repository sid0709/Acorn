"use client";

import { useState } from "react";
import {
  Banner,
  Button,
  Dialog,
  DialogHeader,
  Glyph,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  MoreMenu,
  Stack,
  Text,
  TextArea,
} from "sid-ui";

import { useNotice } from "@/components/use-notice";
import { endSupportSessionsAction, startSupportSessionAction } from "@/lib/actions/support";
import { SUPPORT_SESSION_HOURS } from "@/lib/config";

const DIALOG_WIDTH = 480;
/** supportaccess.MaxReasonLength in acorn-backend. */
const MAX_REASON_LENGTH = 500;
/** Opens the support tab without giving it a handle back to this page. */
const NEW_TAB_FEATURES = "noopener";

/**
 * "Sign in as user": asks why, then opens the client site signed in as this user
 * in a new tab. The site hands the same support session to the Acorn extension.
 */
export function SupportActions({
  userId,
  userName,
  deactivated = false,
}: {
  userId: string;
  userName: string;
  deactivated?: boolean;
}) {
  const notice = useNotice();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    // Open the tab inside the click so the browser does not block it as a pop-up.
    const tab = window.open("about:blank", "_blank");
    setBusy(true);
    setError("");
    const result = await startSupportSessionAction(userId, reason.trim());
    setBusy(false);
    if (!result.ok) {
      tab?.close();
      setError(result.error);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.value;
    } else {
      window.open(result.value, "_blank", NEW_TAB_FEATURES);
    }
    setOpen(false);
    setReason("");
    notice({
      kind: "info",
      title: `Opened Acorn as ${userName}`,
      detail: `The session ends in ${SUPPORT_SESSION_HOURS} hours.`,
    });
  };

  const endAll = async () => {
    const result = await endSupportSessionsAction(userId);
    notice(
      result.ok
        ? {
            kind: "info",
            title: `Ended ${result.value} support session${result.value === 1 ? "" : "s"}`,
          }
        : { kind: "error", title: "Couldn’t end support sessions", detail: result.error },
    );
  };

  return (
    <HStack gap={2} vAlign="center">
      {deactivated ? null : (
        <Button
          label="Sign in as user"
          variant="primary"
          icon={<Glyph name="eye" />}
          onClick={() => setOpen(true)}
        />
      )}
      <MoreMenu
        label="Support actions"
        variant="ghost"
        alignment="end"
        items={[
          {
            label: "End support sessions",
            description: "Signs support out on the site and the extension",
            icon: <Glyph name="signOut" />,
            onClick: () => void endAll(),
          },
        ]}
      />
      <Dialog isOpen={open} onOpenChange={setOpen} purpose="form" width={DIALOG_WIDTH}>
        <Layout
          height="auto"
          header={
            <DialogHeader
              title={`Sign in as ${userName}`}
              subtitle="Opens the Acorn site as this user in a new tab. The Acorn extension in this browser follows."
              onOpenChange={setOpen}
              hasDivider
            />
          }
          content={
            <LayoutContent>
              <Stack gap={4}>
                <TextArea
                  label="Reason"
                  description="Saved to the user's audit trail."
                  placeholder="e.g. Claim about Fill skipping the address step"
                  value={reason}
                  onChange={(value) => setReason(value)}
                  maxLength={MAX_REASON_LENGTH}
                  rows={3}
                  isRequired
                  hasAutoFocus
                />
                <Text type="supporting" color="secondary">
                  {`You act as the user for ${SUPPORT_SESSION_HOURS} hours.`} AI calls you make are
                  tagged as support and left out of their statistics. Deleting the account is
                  blocked.
                </Text>
                {error ? (
                  <Banner status="error" title="Couldn’t start the session" description={error} />
                ) : null}
              </Stack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button label="Cancel" variant="ghost" onClick={() => setOpen(false)} />
                <Button
                  label="Open as user"
                  variant="primary"
                  isDisabled={busy || !reason.trim()}
                  onClick={() => void start()}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </HStack>
  );
}
