import { createTransport } from 'nodemailer';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface EmailMessage extends EmailContent {
  to: string;
}

/** Sends one email. Throws on failure (the dispatcher retries the event). */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
}

/** SMTP via nodemailer (Mailhog on localhost:1025 in dev). Port 465 uses implicit TLS. */
export function createSmtpMailer(config: SmtpConfig): Mailer & { close(): void } {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    ...(config.user !== undefined ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(message) {
      await transport.sendMail({ from: config.from, ...message });
    },
    close() {
      transport.close();
    },
  };
}
