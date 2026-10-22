import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  OAK_RUNTIME_FILE_KEY,
  oakRuntimeFilePath,
} from '../constants/oak.constants';

@Injectable()
export class OakRuntimeFileService {
  async getRuntimeFile() {
    const filePath = oakRuntimeFilePath();
    if (!filePath) {
      throw new NotFoundException({
        success: false,
        error: 'OAK_RUNTIME_FILE_PATH is not set',
      });
    }

    try {
      const buffer = await readFile(filePath);
      return {
        file: {
          key: OAK_RUNTIME_FILE_KEY,
          name: path.basename(filePath),
          mimeType: mimeTypeForPath(filePath),
          base64: buffer.toString('base64'),
        },
      };
    } catch (err) {
      throw new NotFoundException({
        success: false,
        error: `Runtime file not found at ${filePath}`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (ext === '.doc') return 'application/msword';
  if (ext === '.txt') return 'text/plain';
  return 'application/octet-stream';
}
