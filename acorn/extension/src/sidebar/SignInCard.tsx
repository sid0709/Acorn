import { useState } from "react";
import { Button, Text, TextInput, VStack } from "sid-ui";

import { AcornFaceView } from "../acorn-face/AcornFaceView";
import { ACORN_FACE_HELP_PX } from "../acorn-face/constants";

import type { AcornFaceMode } from "@acorn/face";

type SignInCardProps = {
  authBusy: boolean;
  faceMode: AcornFaceMode;
  onSignIn: (email: string, password: string) => void;
};

/** Signed-out welcome. Sign in with the profile email and extension password. */
export function SignInCard({ authBusy, faceMode, onSignIn }: SignInCardProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
      <VStack gap={3} width="100%">
        <TextInput
          label="Profile email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <TextInput
          label="Extension password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </VStack>
      <Button
        variant="primary"
        size="lg"
        label={authBusy ? "Signing in…" : "Sign in"}
        isLoading={authBusy}
        isDisabled={authBusy || !email.trim() || !password}
        width="100%"
        onClick={() => onSignIn(email.trim(), password)}
      />
      <Text type="supporting" color="secondary" justify="center">
        Set the extension password on your Acorn profile (Account tab), then sign in here with that
        email and password.
      </Text>
    </VStack>
  );
}
