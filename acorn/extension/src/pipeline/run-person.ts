/**
 * When the run waits for the applicant. The decision model can answer that a page
 * asks for something only a person can do (a bot check, a code sent to a phone); a
 * page with fields to fill is still filled by the run, since a challenge shows only
 * when the form is sent. Only a page the run already tried to send, or one with
 * nothing to fill, waits.
 */

export type PersonWaitInput = {
  /** The decision model answered that the page asks for something only the applicant can do. */
  needsPerson: boolean;
  /** How many fields the page asks for. */
  fields: number;
  /** Forward clicks the run already made on this page. */
  clicks: number;
};

/** Whether the run should wait for the applicant instead of filling and sending the page. */
export function shouldWaitForPerson(input: PersonWaitInput): boolean {
  if (!input.needsPerson) return false;
  // Whatever the page is read as (an application, an account step), fields the run can
  // fill are filled and sent first: a challenge shows only when the send is refused.
  if (input.fields > 0 && input.clicks === 0) return false;
  return true;
}

/** Whether a page read while waiting still asks for something only the applicant can do. */
export function stillAsksForPerson(read: {
  needsPerson: boolean;
  mailVerification: boolean;
}): boolean {
  return read.needsPerson || read.mailVerification;
}
