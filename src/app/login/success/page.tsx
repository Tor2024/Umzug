import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSessionAsync, ROLE_HOME } from "@/lib/auth";

export const instant = false;

/** После входа: редирект на домашнюю страницу роли (§1). */
export default async function LoginSuccessPage() {
  await connection(); // Route uses cookies + DB time — render at request time
  const user = await getSessionAsync();
  if (!user) redirect("/login");
  redirect(ROLE_HOME[user.role]);
}
