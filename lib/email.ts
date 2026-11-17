/** Forge's outgoing email, through Resend. The sender domain is the one College Apps already verified. */

const FROM = "Forge <no-reply@n3el.dev>";
const RESEND_URL = "https://api.resend.com/emails";

export type OutgoingEmail = { subject: string; text: string; html: string };

/** Sends one email. With DEV_EMAIL=1 (local development) it's printed instead. Never logs the body. */
export async function sendEmail(to: string, email: OutgoingEmail): Promise<void> {
  if (process.env.DEV_EMAIL === "1") {
    console.info(`[dev email] to=${to} subject=${email.subject}\n${email.text}`);
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject: email.subject, text: email.text, html: email.html }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}
