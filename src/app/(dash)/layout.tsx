// Layout панелей управления (route group (dash), требование @1641):
// сайдбар в стиле бухгалтерских программ + плотный контент.
// Панели: account, admin, analytics, dispatch, driver, finance, inbox.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb, findSession, type SessionUser } from "@/lib/db";
import { COOKIE } from "@/lib/auth";
import { DashSidebar } from "@/components/dash-sidebar";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  let user: SessionUser | null = null;
  if (token) {
    const db = await getDb();
    user = await findSession(db, token);
  }
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <DashSidebar userName={user.name} role={user.role} />
      <div className="min-w-0 flex-1 bg-page">
        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
