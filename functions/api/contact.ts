/**
 * POST /api/contact — Cloudflare Pages Function.
 *
 * Order of operations matters: the message is written to D1 FIRST, then the
 * email is attempted. A failed email must never lose a message, so the write is
 * the source of truth and the notification is best-effort. The response is 200
 * as soon as the row lands.
 */

interface Env {
  DB: D1Database;
  RESEND_API_KEY?: string;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
}

interface Body {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  message?: unknown;
  /** Honeypot: a real person never fills this, it is hidden from them. */
  website?: unknown;
  /** Milliseconds between form render and submit. */
  elapsed?: unknown;
}

const LIMITS = { name: 120, email: 200, company: 160, message: 4000 } as const;

// Deliberately permissive. Strict address grammar rejects valid addresses far
// more often than it catches typos, and the real check is whether a reply lands.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Field-keyed errors so the form can mark the offending input, not just alert. */
function validate(b: Body) {
  const name = clean(b.name, LIMITS.name);
  const email = clean(b.email, LIMITS.email).toLowerCase();
  const company = clean(b.company, LIMITS.company);
  const message = clean(b.message, LIMITS.message);
  const errors: Record<string, string> = {};

  if (name.length < 2) errors.name = "Please enter your name.";
  if (!EMAIL.test(email)) errors.email = "That email address doesn't look right.";
  if (message.length < 12) errors.message = "A sentence or two, so I know what this is about.";

  return { fields: { name, email, company, message }, errors };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Malformed request." }, 400);
  }

  // Two silent bot filters. Both return 200 with ok:true — telling a bot it was
  // caught only teaches whoever wrote it to adapt.
  const trap = clean(body.website, 200);
  const elapsed = typeof body.elapsed === "number" ? body.elapsed : 0;
  if (trap || (elapsed > 0 && elapsed < 2000)) {
    return json({ ok: true, id: null });
  }

  const { fields, errors } = validate(body);
  if (Object.keys(errors).length) return json({ ok: false, errors }, 422);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const country = (request as { cf?: { country?: string } }).cf?.country ?? "";

  try {
    await env.DB.prepare(
      `INSERT INTO messages (id, name, email, company, message, ip, country, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(id, fields.name, fields.email, fields.company, fields.message, ip, country, now)
      .run();
  } catch (err) {
    console.error("contact: D1 insert failed", err);
    return json({ ok: false, error: "Could not save your message. Please email me directly." }, 500);
  }

  // Best-effort from here. The message is already durable.
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: env.NOTIFY_FROM ?? "site@aadityakushwaha.com",
          to: env.NOTIFY_TO ?? "work.aadityak@gmail.com",
          // Reply goes to the sender, so replying from the inbox just works.
          reply_to: fields.email,
          subject: `Site contact — ${fields.name}${fields.company ? ` (${fields.company})` : ""}`,
          text: [
            `From:    ${fields.name} <${fields.email}>`,
            fields.company ? `Company: ${fields.company}` : null,
            country ? `Country: ${country}` : null,
            `Time:    ${now}`,
            "",
            fields.message,
            "",
            `— id ${id}`,
          ]
            .filter(Boolean)
            .join("\n"),
        }),
      });
      if (!res.ok) console.error("contact: resend rejected", res.status, await res.text());
    } catch (err) {
      console.error("contact: resend request failed", err);
    }
  }

  return json({ ok: true, id });
};

/** Anything other than POST on this path is a mistake worth naming. */
export const onRequest: PagesFunction<Env> = async ({ request, next }) => {
  if (request.method === "POST") return next();
  return json({ ok: false, error: "Use POST." }, 405);
};
