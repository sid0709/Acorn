import {
  MAX_NOTES_LENGTH,
  claimTitle,
  listTimeLabel,
  pageHost,
  type SupportClaim,
} from "@acorn/support-chat";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogHeader,
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  RadioList,
  RadioListItem,
  SegmentedControl,
  SegmentedControlItem,
  Stack,
  Text,
  TextArea,
} from "sid-ui";

/** A fresh report, or this page added to a report that is still open. */
const REPORT_MODE = { fresh: "fresh", followUp: "follow-up" } as const;
type ReportMode = (typeof REPORT_MODE)[keyof typeof REPORT_MODE];

const COPY: Record<
  ReportMode,
  { notesLabel: string; placeholder: string; sends: string; action: string }
> = {
  fresh: {
    notesLabel: "What went wrong?",
    placeholder: "e.g. Fill typed my postcode into the city field",
    sends:
      "Acorn sends this page’s address, a screenshot of the whole page, and this tab’s debug log when one was recorded. Support replies in the Support tab.",
    action: "Send report",
  },
  "follow-up": {
    notesLabel: "What happened this time?",
    placeholder: "e.g. Same thing again, on the next step",
    sends:
      "Acorn adds this page’s address, a screenshot of the whole page, and this tab’s debug log when one was recorded. It opens that conversation.",
    action: "Add to report",
  },
};

/**
 * Asks what went wrong before Acorn screenshots the page. It files a new report, or
 * (Follow-up) adds the page, screenshot, debug log, and notes to one of the person's open reports.
 */
export function ReportDialog({
  isOpen,
  onOpenChange,
  openClaims,
  sending,
  onSend,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page being reported, shown so the person knows what is sent. */
  /** The person's open reports, newest conversation first: what a follow-up can join. */
  openClaims: SupportClaim[];
  sending: boolean;
  /**
   * Files the notes as a new report (claimId null) or adds them to that report.
   * Resolves true once sent; the notes stay for a retry otherwise.
   */
  onSend: (notes: string, claimId: string | null) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState("");
  const [chosenMode, setMode] = useState<ReportMode>(REPORT_MODE.fresh);
  const [picked, setPicked] = useState("");
  const canFollowUp = openClaims.length > 0;
  const mode = canFollowUp ? chosenMode : REPORT_MODE.fresh;
  const target = openClaims.some((claim) => claim.id === picked) ? picked : openClaims[0]?.id;
  const copy = COPY[mode];

  const close = (open: boolean) => {
    if (sending) return;
    onOpenChange(open);
  };
  const submit = () => {
    const claimId = mode === REPORT_MODE.followUp ? (target ?? null) : null;
    void onSend(notes.trim(), claimId).then((sent) => {
      if (sent) setNotes("");
    });
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={close} purpose="form">
      <Layout
        height="auto"
        header={<DialogHeader title="Notes to Support" onOpenChange={close} hasDivider />}
        content={
          <LayoutContent>
            <Stack gap={3}>
              <SegmentedControl
                label="New report or follow-up"
                value={mode}
                onChange={(value) => setMode(value as ReportMode)}
                layout="fill"
                isDisabled={sending}
              >
                <SegmentedControlItem value={REPORT_MODE.fresh} label="New report" />
                <SegmentedControlItem
                  value={REPORT_MODE.followUp}
                  label="Follow-up"
                  isDisabled={!canFollowUp}
                />
              </SegmentedControl>
              {!canFollowUp ? (
                <Text type="supporting">
                  Follow-up adds this page to a report you already opened. You have none open now.
                </Text>
              ) : null}
              {mode === REPORT_MODE.followUp && target ? (
                <RadioList
                  label="Add this page to"
                  value={target}
                  onChange={setPicked}
                  isDisabled={sending}
                >
                  {openClaims.map((claim) => (
                    <RadioListItem
                      key={claim.id}
                      value={claim.id}
                      label={claimTitle(claim)}
                      description={`${pageHost(claim.pageUrl)} · ${listTimeLabel(claim.lastMessageAt)}`}
                    />
                  ))}
                </RadioList>
              ) : null}
              <TextArea
                label={copy.notesLabel}
                placeholder={copy.placeholder}
                value={notes}
                onChange={(value) => setNotes(value)}
                maxLength={MAX_NOTES_LENGTH}
                rows={4}
                hasAutoFocus
              />
              <Text type="supporting">{copy.sends}</Text>
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
                label={sending ? "Capturing page…" : copy.action}
                variant="primary"
                isDisabled={sending}
                onClick={submit}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}
