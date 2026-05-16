type TransactionalEmailArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

const BREVO_SEND_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

function getFromEmail(): string {
  return process.env.SECURITY_EMAIL_FROM?.trim() ||
    process.env.BREVO_FROM_EMAIL?.trim() ||
    "no-reply@wardnexus.app";
}

function getFromName(): string {
  return process.env.SECURITY_EMAIL_FROM_NAME?.trim() ||
    process.env.BREVO_FROM_NAME?.trim() ||
    "Ward Nexus";
}

export function isSecurityEmailConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY?.trim());
}

export async function sendSecurityEmail(args: TransactionalEmailArgs): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();

  if (!apiKey) {
    const preview = [
      `[email disabled] To: ${args.to}`,
      `[email disabled] Subject: ${args.subject}`,
      args.text
    ].join("\n");

    if (process.env.NODE_ENV === "production") {
      throw new Error("Brevo email is not configured. Set BREVO_API_KEY and SECURITY_EMAIL_FROM.");
    }

    console.log(preview);
    return;
  }

  const response = await fetch(BREVO_SEND_EMAIL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      sender: {
        email: getFromEmail(),
        name: getFromName()
      },
      to: [{ email: args.to }],
      subject: args.subject,
      textContent: args.text,
      htmlContent: args.html ?? args.text.replace(/\n/g, "<br>")
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo email failed: ${response.status} ${body.slice(0, 240)}`);
  }
}
