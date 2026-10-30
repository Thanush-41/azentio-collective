// Provider-backed email via Resend's HTTPS API. Returns whether the provider ACCEPTED the message; this is not proof of delivery.
export type MailResult = { accepted: boolean; reason?: string };

export async function sendMail(to: string, subject: string, text: string, env: Record<string, string | undefined> = process.env): Promise<MailResult> {
  const key = env.RESEND_API_KEY, from = env.MAIL_FROM;
  if (!key || !from) return { accepted: false, reason: "Email provider is not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, text }) });
    return res.ok ? { accepted: true } : { accepted: false, reason: `Provider returned ${res.status}` };
  } catch { return { accepted: false, reason: "Email provider unreachable" }; }
}
