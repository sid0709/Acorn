import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACCOUNT_MODE,
  type AccountAttempt,
  type AccountMode,
} from "../../../packages/shared/run-types.ts";

import {
  IDENTIFIED,
  emptyAccountEvidence,
  identifiedBy,
  isGuestPath,
  needsAccountPassword,
  nextAccountGoal,
  triedGoals,
  withOffers,
  type AccountPage,
  type SiteAccountEvidence,
} from "./account-goal.ts";

const { signIn, createAccount, resetPassword, choose, identify } = ACCOUNT_MODE;

const sent = (mode: AccountMode, accepted: boolean): AccountAttempt => ({
  mode,
  accepted,
  messages: [],
});
const page = (mode: AccountMode | null, offers: AccountMode[] | null): AccountPage => ({
  mode,
  offers,
});
const evidence = (patch: Partial<SiteAccountEvidence> = {}): SiteAccountEvidence => ({
  ...emptyAccountEvidence(),
  ...patch,
});

describe("nextAccountGoal", () => {
  it("signs in first on a sign-in page", () => {
    assert.equal(
      nextAccountGoal([], evidence(), page(signIn, [signIn, createAccount, resetPassword])),
      signIn,
    );
  });

  it("signs in first from a page that only shows how to start", () => {
    assert.equal(nextAccountGoal([], evidence(), page(choose, [signIn])), signIn);
  });

  it("creates the account when that is all the page offers", () => {
    assert.equal(
      nextAccountGoal([], evidence(), page(createAccount, [createAccount])),
      createAccount,
    );
  });

  it("creates the account after a refused sign-in when the site offers it", () => {
    const attempts = [sent(signIn, false)];
    assert.equal(
      nextAccountGoal(attempts, evidence(), page(signIn, [signIn, createAccount, resetPassword])),
      createAccount,
    );
  });

  it("remembers a create offer from an earlier page of the site", () => {
    const attempts = [sent(signIn, false)];
    const site = evidence({ offers: [signIn, createAccount] });
    assert.equal(
      nextAccountGoal(attempts, site, page(signIn, [signIn, resetPassword])),
      createAccount,
    );
  });

  it("resets the password after a refused sign-in when no create is offered", () => {
    const attempts = [sent(signIn, false)];
    assert.equal(
      nextAccountGoal(
        attempts,
        evidence({ offers: [signIn, resetPassword] }),
        page(signIn, [signIn, resetPassword]),
      ),
      resetPassword,
    );
  });

  it("signs in again after creating the account", () => {
    const attempts = [sent(signIn, false), sent(createAccount, true)];
    assert.equal(nextAccountGoal(attempts, evidence(), page(choose, [signIn])), signIn);
  });

  it("resets after the sign-in that followed a new account is refused", () => {
    const attempts = [sent(signIn, false), sent(createAccount, true), sent(signIn, false)];
    assert.equal(
      nextAccountGoal(attempts, evidence(), page(signIn, [signIn, resetPassword])),
      resetPassword,
    );
  });

  it("resets when creating is refused after a refused sign-in (the account exists)", () => {
    const attempts = [sent(signIn, false), sent(createAccount, false)];
    assert.equal(
      nextAccountGoal(
        attempts,
        evidence(),
        page(createAccount, [createAccount, signIn, resetPassword]),
      ),
      resetPassword,
    );
  });

  it("keeps signing in once the site took the first part of a sign-in", () => {
    assert.equal(nextAccountGoal([sent(signIn, true)], evidence(), page(signIn, [signIn])), signIn);
  });

  it("saves the new password when the emailed link opens the reset form", () => {
    const attempts = [sent(signIn, false), sent(resetPassword, true)];
    assert.equal(
      nextAccountGoal(attempts, evidence(), page(resetPassword, [resetPassword])),
      resetPassword,
    );
  });

  it("signs in after the reset, and stops when that sign-in is refused", () => {
    const reset = [sent(signIn, false), sent(resetPassword, true), sent(resetPassword, true)];
    assert.equal(nextAccountGoal(reset, evidence(), page(signIn, [signIn])), signIn);
    assert.equal(
      nextAccountGoal([...reset, sent(signIn, false)], evidence(), page(signIn, [signIn])),
      null,
    );
  });

  it("stops when the reset itself is refused", () => {
    const attempts = [sent(signIn, false), sent(resetPassword, false)];
    assert.equal(nextAccountGoal(attempts, evidence(), page(resetPassword, [resetPassword])), null);
  });

  it("opens the due step from a page that shows another form", () => {
    // Refused sign-in on a password page that only links to a reset: open the reset.
    assert.equal(
      nextAccountGoal(
        [sent(signIn, false)],
        evidence({ identified: IDENTIFIED.existing }),
        page(signIn, [signIn, resetPassword]),
      ),
      resetPassword,
    );
  });

  it("never creates an account the email-first step showed exists", () => {
    const site = evidence({ identified: IDENTIFIED.existing, offers: [createAccount] });
    assert.equal(
      nextAccountGoal([sent(signIn, false)], site, page(signIn, [signIn, createAccount])),
      resetPassword,
    );
  });

  it("creates first when the email-first step showed the account is new", () => {
    const site = evidence({ identified: IDENTIFIED.new });
    assert.equal(
      nextAccountGoal([], site, page(createAccount, [createAccount, signIn])),
      createAccount,
    );
    assert.equal(
      nextAccountGoal([sent(createAccount, true)], site, page(signIn, [signIn])),
      signIn,
    );
  });

  it("follows the order alone when the backend reports no offers", () => {
    assert.equal(nextAccountGoal([], evidence(), page(signIn, null)), signIn);
    assert.equal(
      nextAccountGoal([sent(signIn, false)], evidence(), page(signIn, null)),
      createAccount,
    );
  });

  it("goes after the due step even when this page does not offer it", () => {
    // The control that leads toward it is picked, or the run goes back to the posting.
    assert.equal(
      nextAccountGoal([sent(signIn, false)], evidence({ offers: [signIn] }), page(identify, [])),
      resetPassword,
    );
  });
});

describe("account evidence", () => {
  it("adds a page's offers to the site's, in goal order", () => {
    const site = withOffers(evidence({ offers: [resetPassword] }), [createAccount, signIn]);
    assert.deepEqual(site.offers, [signIn, createAccount, resetPassword]);
    assert.equal(withOffers(site, null), site);
  });

  it("reads the email-first answer from the form the site showed next", () => {
    assert.equal(identifiedBy(signIn), IDENTIFIED.existing);
    assert.equal(identifiedBy(createAccount), IDENTIFIED.new);
    assert.equal(identifiedBy(choose), null);
  });

  it("lists each tried step once, in the order first tried", () => {
    assert.deepEqual(
      triedGoals([sent(signIn, false), sent(createAccount, true), sent(signIn, false)]),
      [signIn, createAccount],
    );
  });
});

describe("isGuestPath", () => {
  it("is no way around the account when it is the page's own forward control", () => {
    // An email-first step: the read named its Next as both the forward and the guest control.
    assert.equal(isGuestPath({ guestControl: 75, forwardControl: 75, pageFields: 1 }), false);
  });

  it("is a way around the account when it is a control of its own", () => {
    assert.equal(isGuestPath({ guestControl: 12, forwardControl: 75, pageFields: 2 }), true);
    assert.equal(isGuestPath({ guestControl: 12, forwardControl: null, pageFields: 2 }), true);
  });

  it("is a way around the account on a page with nothing to fill", () => {
    assert.equal(isGuestPath({ guestControl: 75, forwardControl: 75, pageFields: 0 }), true);
  });
});

describe("needsAccountPassword", () => {
  it("sends an email-first step without a password", () => {
    assert.equal(needsAccountPassword(identify), false);
  });

  it("needs the password for every other account step", () => {
    for (const mode of [signIn, createAccount, resetPassword, choose]) {
      assert.equal(needsAccountPassword(mode), true);
    }
  });
});
