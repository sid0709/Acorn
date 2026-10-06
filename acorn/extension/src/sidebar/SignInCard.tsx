import type { AcornFaceMode } from "@acorn/face";
import { Button, Text, VStack } from "sid-ui";
import { ACORN_FACE_HELP_PX } from "../acorn-face/constants";
import { AcornFaceView } from "../acorn-face/AcornFaceView";

type SignInCardProps = {
  authBusy: boolean;
  faceMode: AcornFaceMode;
  onSignIn: () => void;
};

/** Signed-out welcome. Google sign-in uses an Acorn account with the same Gmail. */
export function SignInCard({ authBusy, faceMode, onSignIn }: SignInCardProps) {
  return (
    <VStack gap={4} align="center" justify="center" className="acorn-welcome">
      <AcornFaceView mode={faceMode} size={ACORN_FACE_HELP_PX} live label="Acorn" />
      <VStack gap={1} align="center">
        <Text as="h1" type="display-3" weight="semibold">
          Acorn
        </Text>
        <Text type="supporting" justify="center">
          Fills job applications with your Acorn account and the right résumé.
        </Text>
      </VStack>
      <Button
        variant="primary"
        size="lg"
        label={authBusy ? "Connecting…" : "Continue with Google"}
        isLoading={authBusy}
        isDisabled={authBusy}
        width="100%"
        onClick={onSignIn}
      />
      <Text type="supporting" color="secondary" justify="center">
        Uses the Gmail on your Acorn account. A new Gmail needs an account on the Acorn site.
      </Text>
    </VStack>
  );
}
