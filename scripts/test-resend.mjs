// Тест Resend API: отправка тестового письма на email владельца аккаунта.
// usage: RESEND_API_KEY=re_... node scripts/test-resend.mjs <to-email>
const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) { console.error("no RESEND_API_KEY"); process.exit(1); }
const to = process.argv[2];
if (!to) { console.error("usage: node scripts/test-resend.mjs <to>"); process.exit(1); }

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: "Помощник с переездом <onboarding@resend.dev>",
    to,
    subject: "Тест Resend — umzug",
    html: "<p>Тестовое письмо из scripts/test-resend.mjs</p>",
  }),
});
console.log("status:", res.status);
console.log(await res.text());
