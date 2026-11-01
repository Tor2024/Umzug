import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Защита данных (DSGVO)",
  description: "Какие данные обрабатываются при использовании сервиса и на каком основании (DSGVO).",
};

/** Datenschutz по DSGVO: минимально, честно, с перечнем обрабатываемых данных. */
export default function DatenschutzPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">Защита данных</h1>
        <p className="mt-1 text-sm text-muted">Основания — ст. 6 DSGVO. Контролёр данных — компания из Impressum.</p>

        <div className="card mt-6 space-y-5 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">Какие данные мы обрабатываем</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><strong>Аккаунт:</strong> имя, email, пароль (только хеш scrypt, не сам пароль) — исполнение договора, ст. 6 (1) b.</li>
              <li><strong>Заявка на переезд:</strong> адреса, дата, объём, услуги — исполнение договора, ст. 6 (1) b.</li>
              <li><strong>Протокол приёмки:</strong> факт загрузки, подпись — доказательство исполнения, ст. 6 (1) f.</li>
              <li><strong>Счета и платежи:</strong> суммы, даты — бухгалтерские обязанности (GoBD), ст. 6 (1) c.</li>
              <li><strong>Журнал аудита:</strong> кто и какое действие совершил (без содержимого) — безопасность, ст. 6 (1) f.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">Сторонние сервисы</h2>
            <p className="mt-1">
              Расчёт маршрута использует открытые геосервисы OpenStreetMap (Nominatim) и OSRM с German-фильтром.
              При передаче адресов им виден адрес без привязки к вашему аккаунту. При подключении Google Maps
              обработка идёт по Paul-Ehrlich-Str. 15 (Google Ireland) — данные передаются согласно Google-DSGVO-положению.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">Сроки хранения</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Счета и бухгалтерия: 10 лет (GoBD / § 147 AO).</li>
              <li>Протоколы и договоры: 10 лет (доказательство).</li>
              <li>Аудит: 180 дней.</li>
              <li>Сессии: удаляются при выходе, максимум 12 ч.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">Ваши права</h2>
            <p className="mt-1">
              Доступ (ст. 15), исправление (ст. 16), удаление (ст. 17), ограничение (ст. 18),
              переносимость (ст. 20), возражение (ст. 21), жалоба в надзорный орган (ст. 77).
              Запросы: email из Impressum.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">Cookies</h2>
            <p className="mt-1">
              Только технически необходимые: ms_session (вход) и ms_locale (язык). Без согласия,
              так как это работа сайта (§ 25 (2) TDDDG).
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
