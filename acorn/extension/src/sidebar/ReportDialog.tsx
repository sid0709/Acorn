import { MAX_NOTES_LENGTH } from "@acorn/support-chat";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogHeader,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Stack,
  Text,
  TextArea,
} from "sid-ui";

/** Asks what went wrong before Acorn screenshots the page and sends the report. */
export function ReportDialog({
  isOpen,
  onOpenChange,
  pageLabel,
  sending,
  onSend,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page being reported, shown so the person knows what is sent. */
  pageLabel: string;
  sending: boolean;
  /** Resolves true once the report is filed; the notes stay for a retry otherwise. */
  onSend: (notes: string) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState("");
  const close = (open: boolean) => {
    if (sending) return;
    onOpenChange(open);
  };
  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form">
      <Layout
        height="auto"
        header={
          <DialogHeader
            title="Notes to Support"
            subtitle={pageLabel}
            onOpenChange={close}
            hasDivider
          />
        }
        content={
          <LayoutContent>
            <Stack gap={3}>
              <TextArea
                label="What went wrong?"
                placeholder="e.g. Fill typed my postcode into the city field"
                value={notes}
                onChange={(value) => setNotes(value)}
                maxLength={MAX_NOTES_LENGTH}
                rows={4}
                hasAutoFocus
              />
              <Text type="supporting">
                Acorn sends this page’s address and a screenshot of the whole page. Support replies
                in the Support tab.
              </Text>
            </Stack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <Button
                label="Cancel"
                variant="ghost"
                isDisabled={sending}
                onClick={() => close(false)}
              />
              <Button
                label={sending ? "Capturing page…" : "Send report"}
                variant="primary"
                isDisabled={sending}
                onClick={() => {
                  void onSend(notes.trim()).then((sent) => {
                    if (sent) setNotes("");
                  });
                }}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
