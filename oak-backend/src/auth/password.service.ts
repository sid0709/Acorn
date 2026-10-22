import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  BCRYPT_ROUNDS,
  LEGACY_DEFAULT_PASSWORD,
} from './constants/auth.constants';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async verify(
    storedHash: string | null | undefined,
    password: string,
  ): Promise<boolean> {
    if (!storedHash) {
      return password === LEGACY_DEFAULT_PASSWORD;
    }
    return bcrypt.compare(password, storedHash);
  }
}
