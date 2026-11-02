import { connection } from "next/server";
import { consumeEmailChangeToken } from "@/lib/auth-actions";

export const metadata = { robots: { index: false, follow: false }, title: "Смена email" };
export const instant = false;

export default async function EmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await connection(); // DB-запрос по токену — только в рантайме
  const { token } = await searchParams;
  const result = token
    ? await consumeEmailChangeToken(token)
    : { ok: false, message: "Ссылка неполная — откройте её из письма." };

  return (
    <>
      <h1 className="text-xl font-bold">Смена email</h1>
      <p className={result.ok ? "mt-4 text-green-700" : "mt-4 text-red-600"}>{result.message}</p>
      <a className="btn btn-primary mt-6 inline-block" href="/account">В личный кабинет</a>
    </>
  );
}
