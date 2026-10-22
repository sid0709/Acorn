/** Protocol values for AccountInfo.userStatus. */
export const USER_STATUS = {
  pending: 'Pending',
  approved: 'Approved',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/** True for Approved or missing/null (legacy accounts created before approval). */
export function isApprovedUserStatus(
  value: string | null | undefined,
): boolean {
  const normalized = String(value ?? '').trim();
  return !normalized || normalized === USER_STATUS.approved;
}
