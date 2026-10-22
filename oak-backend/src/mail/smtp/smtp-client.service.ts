import { Injectable } from '@nestjs/common';
import dns from 'node:dns';
import nodemailer from 'nodemailer';

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;

function ipv4Lookup(
  hostname: string,
  options: dns.LookupOneOptions | number | undefined,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
) {
  const opts =
    typeof options === 'object' && options
      ? { ...options, family: 4 as const, all: false as const }
      : { family: 4 as const };
  dns.lookup(hostname, opts, callback);
}

function friendlySmtpError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const code = e?.code || '';
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'ENETUNREACH' || /ENETUNREACH/i.test(message)) {
    return 'Could not reach Gmail SMTP (network unreachable). Check your network or try again.';
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(message)) {
    return 'Gmail SMTP timed out. Check your network connection and Gmail app password.';
  }
  if (
    code === 'EAUTH' ||
    /Invalid login|Username and Password not accepted/i.test(message)
  ) {
    return 'Gmail rejected the login. Verify the address and app password in Settings → Profile.';
  }
  return message || 'Failed to send mail';
}

@Injectable()
export class SmtpClientService {
  async sendMail(input: {
    email: string;
    password: string;
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
  }) {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: true,
      auth: { user: input.email, pass: input.password },
      connectionTimeout: 20_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      lookup: ipv4Lookup,
    } as nodemailer.TransportOptions);
    try {
      const mailOptions: Record<string, unknown> = {
        from: input.email,
        to: input.to,
        subject: input.subject,
        text: input.body,
        html: input.body.includes('<') ? input.body : undefined,
      };
      if (input.inReplyTo) mailOptions.inReplyTo = input.inReplyTo;
      if (input.references) mailOptions.references = input.references;

      const info = await transport.sendMail(mailOptions);
      return {
        messageId: info.messageId,
        accepted: info.accepted,
      };
    } catch (err) {
      const wrapped = new Error(friendlySmtpError(err)) as Error & {
        cause?: unknown;
        code?: string;
      };
      wrapped.cause = err;
      wrapped.code = (err as { code?: string })?.code;
      throw wrapped;
    } finally {
      transport.close();
    }
  }
}
