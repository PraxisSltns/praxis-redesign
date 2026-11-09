/**
 * Sends the sign-in email. With RESEND_API_KEY and MAIL_FROM set, through Resend's HTTP API; without
 * them, outside production, the message goes to an in-memory outbox and the server log instead, so local
 * development and tests can sign in with no mail service. In production with no key there is no mailer,
 * and sign-in answers that it isn't available rather than pretending to send.
 */

/** Messages "sent" without a mail service (newest last), for tests and local development. */
export const outbox = [];

export function createMailer(env = process.env, fetcher = fetch) {
  const key = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.MAIL_FROM ?? "").trim();
  if (key && from) {
    return {
      kind: "resend",
      async send({ to, subject, text, html }) {
        const res = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text, html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw Object.assign(new Error(`Resend answered ${res.status}`), { status: res.status });
      },
    };
  }
  if (env.NODE_ENV === "production") return null;
  return {
    kind: "outbox",
    async send(message) {
      outbox.push({ ...message, at: new Date().toISOString() });
      if (outbox.length > 50) outbox.shift();
      // Local development only (never in production): the link is in the log so you can click it.
      if (env.AUTH_OUTBOX_LOG !== "off") console.log(`[sign-in email to ${message.to}] ${message.link}`);
    },
  };
}
