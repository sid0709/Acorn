/** Protocol constant — matches account_info.permission admin contract. */
export const ADMIN_PERMISSION = 'admin' as const;

export const ADMIN_APPLIER_HEADER = 'x-applier-name' as const;

export function isAdminPermission(
  permission: string | null | undefined,
): boolean {
  return (
    String(permission ?? '')
      .trim()
      .toLowerCase() === ADMIN_PERMISSION
  );
}
