import nodemailer from 'nodemailer';

let transporterPromise = null;

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function resolveMailFrom() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@vbpm.local';
}

async function createTransporter() {
  if (process.env.NODE_ENV === 'test') {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (!isSmtpConfigured()) {
    return nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.verify();
  return transporter;
}

async function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = createTransporter().catch((error) => {
      transporterPromise = null;
      throw error;
    });
  }

  return transporterPromise;
}

export async function sendPlatformEmail({
  to,
  subject,
  text,
  html = null,
  replyTo = null,
}) {
  const recipients = Array.isArray(to)
    ? to.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [String(to || '').trim()].filter(Boolean);

  if (!recipients.length || !subject || !text) {
    return { skipped: true, reason: 'missing-email-fields' };
  }

  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: resolveMailFrom(),
    to: recipients.join(', '),
    subject,
    text,
    html: html || undefined,
    replyTo: replyTo || undefined,
  });

  if (!isSmtpConfigured()) {
    console.log('[mailer] SMTP not configured; generated email payload:', info.message?.toString?.() || info.message || info);
  }

  return {
    skipped: false,
    previewOnly: !isSmtpConfigured(),
    messageId: info.messageId || null,
  };
}

export default sendPlatformEmail;
