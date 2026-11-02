// DE-Layout панелей управления (/de/* route group-зеркало (dash)).
// Тот же DashSidebar с locale="de"; редирект на /de/login при отсутствии сессии.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb, findSession, type SessionUser } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { DashSidebar } from "@/components/dash-sidebar";
import { DeLocaleCookie } from "@/components/de-locale-cookie";

export default async function DashLayoutDe({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  let user: SessionUser | null = null;
  if (token) {
    const db = await getDb();
    user = await findSession(db, token);
  }
  if (!user) redirect("/de/login");

  return (
    <div className="flex min-h-screen">
      <DeLocaleCookie />
      <DashSidebar userName={user.name} role={user.role} locale="de" />
      <div className="min-w-0 flex-1 bg-page">
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
