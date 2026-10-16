import { SignInCard } from "./SignInCard";

import type { SidebarAuth } from "./sidebar-panel-types";
import type { AcornFaceMode } from "@acorn/face";

interface Props {
  authBusy: SidebarAuth["authBusy"];
  handleSignIn: SidebarAuth["handleSignIn"];
  companionMode: AcornFaceMode;
}

/** Signed out: the sign-in card. */
export function SignedOutView({ authBusy, handleSignIn, companionMode }: Props) {
  return (
    <main className="sidebar-scroll">
      <SignInCard
        authBusy={authBusy}
        faceMode={companionMode}
        onSignIn={(email, password) => void handleSignIn(email, password)}
      />
    </main>
  );
}
