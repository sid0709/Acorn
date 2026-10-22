declare module '@nextoffer/shared/secretCrypto' {
  export function isEncryptedSecret(value: unknown): boolean;
  export function encryptSecret(plaintext: string): string;
  export function decryptSecret(value: string): string;
}
