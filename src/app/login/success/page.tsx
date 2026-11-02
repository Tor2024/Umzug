import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { getSessionAsync, ROLE_HOME } from "@/lib/auth";

export const instant = false;

/** После входа: редирект на домашнюю страницу роли (§1).
 *  Локаль: если пользователь логинился через /de (cookie locale=de) — на DE-зеркало роли. */
export default async function LoginSuccessPage() {
  await connection(); // Route uses cookies + DB time — render at request time
  const user = await getSessionAsync();
  if (!user) redirect("/login");
  const jar = await cookies();
  const home = ROLE_HOME[user.role];
  redirect(jar.get("locale")?.value === "de" ? `/de${home}` : home);
}
