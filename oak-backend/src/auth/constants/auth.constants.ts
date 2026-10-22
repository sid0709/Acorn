/** Protocol constants for Athens-compatible auth (not domain vocabulary). */
export const BCRYPT_ROUNDS = 10;

/** Legacy Athens-server accounts with no password hash. */
export const LEGACY_DEFAULT_PASSWORD = '12345678';

export const AuthMessages = {
  namePasswordRequired: 'Name and password are required',
  invalidCredentials: 'Invalid credentials',
  userExists: 'User already exists',
  userCreated: 'User created successfully',
  userCreatedPending:
    'Account created. An admin must approve it before you can sign in.',
  accountPendingApproval:
    'This account is pending approval. You can sign in after an admin approves it.',
  userApproved: 'User approved',
  signedIn: 'Signed in successfully',
  changePasswordRequired:
    'Name, current password, and new password are required',
  newPasswordTooShort: 'New password must be at least 8 characters',
  accountNotFound: 'Account not found',
  currentPasswordIncorrect: 'Current password is incorrect',
  passwordUpdated: 'Password updated successfully',
  changeUsernameRequired:
    'Current username, new username, and password are required',
  usernameInvalid:
    'Username must be 2–64 characters and use only letters, numbers, dots, hyphens, or underscores',
  usernameUnchanged: 'Username is already that value',
  usernameUpdated: 'Username updated successfully',
  nameRequired: 'Name is required',
  vendorPasswordRequired:
    'Provide vendorPassword (min 8 characters) or clear: true',
  vendorPasswordUpdated: 'Vendor access password updated',
  vendorPasswordCleared: 'Vendor access password cleared',
  deleteAccountRequired: 'Name, password, and confirmName are required',
  confirmNameMismatch: 'confirmName must match the account name exactly',
  passwordIncorrect: 'Password is incorrect',
  accountDeleted: 'Account deleted successfully',
} as const;

export const MIN_NEW_PASSWORD_LENGTH = 8;
