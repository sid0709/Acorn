import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import {
  App,
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { Bucket } from '@google-cloud/storage';
import { loadFirebaseConfig, type FirebaseConfig } from './firebase.config';

export type FirebaseMeta = FirebaseConfig & {
  initError: string | null;
};

/**
 * Lazy Firebase Admin SDK bootstrap. Exported for reuse by explorer and
 * future Firestore/Storage features — not tied to HTTP.
 */
@Injectable()
export class FirebaseAdminService {
  private initError: Error | null = null;
  private readonly config = loadFirebaseConfig();

  getMeta(): FirebaseMeta {
    return {
      ...this.config,
      initError: this.initError?.message ?? null,
    };
  }

  firestore(): Firestore {
    this.ensureApp();
    return getFirestore();
  }

  auth(): Auth {
    this.ensureApp();
    return getAuth();
  }

  storageBucket(): Bucket {
    this.ensureApp();
    const storage = getStorage();
    return this.config.storageBucket
      ? storage.bucket(this.config.storageBucket)
      : storage.bucket();
  }

  private ensureApp(): App {
    const existing = getApps();
    if (existing.length > 0) {
      return existing[0];
    }

    const projectId = this.config.projectId || undefined;
    const storageBucket = this.config.storageBucket || undefined;

    try {
      const serviceAccount = this.loadServiceAccount();
      return initializeApp({
        credential: cert(serviceAccount),
        projectId: projectId || serviceAccount.project_id,
        storageBucket,
      });
    } catch (err) {
      try {
        return initializeApp({
          credential: applicationDefault(),
          projectId,
          storageBucket,
        });
      } catch (adcErr) {
        this.initError = err instanceof Error ? err : new Error(String(err));
        const adcMessage =
          adcErr instanceof Error ? adcErr.message : String(adcErr);
        throw new Error(
          `${this.initError.message} (ADC fallback failed: ${adcMessage})`,
        );
      }
    }
  }

  private loadServiceAccount(): ServiceAccount & { project_id?: string } {
    const credPath = this.config.credentialsPath;
    if (!credPath) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS is not set');
    }
    if (!fs.existsSync(credPath)) {
      throw new Error(`Service account file not found: ${credPath}`);
    }
    const raw = fs.readFileSync(credPath, 'utf8');
    return JSON.parse(raw) as ServiceAccount & { project_id?: string };
  }
}
