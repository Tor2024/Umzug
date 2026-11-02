const key = process.env.RESEND_API_KEY;
const res = await fetch("https://api.resend.com/emails", {
  headers: { Authorization: `Bearer ${key}` },
});
const data = await res.json();
const items = (data.data ?? []).slice(0, 3);
for (const e of items) {
  console.log(`${e.created_at} | ${e.to} | ${e.subject} | ${e.last_event}`);
}
