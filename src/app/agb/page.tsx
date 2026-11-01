import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Условия (AGB)",
  description: "Условия перевозки: цена, обязательства сторон, ответственность по HGB, претензии.",
};

/** AGB: отражают фактическую механику системы (снимок цены, приёмка, претензии, HGB-лимиты). */
export default function AgbPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">Общие условия (AGB)</h1>
        <p className="mt-1 text-sm text-muted">Применяются к договору перевозки домашнего имущества (Gütermobelpreise) по HGB.</p>

        <div className="card mt-6 space-y-5 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">1. Цена и снимок тарифов</h2>
            <p className="mt-1">
              Цена рассчитывается из действующих тарифов на момент заявки и фиксируется снимком.
              Подтверждённая логистом цена действует {14} дней и не меняется, даже если тарифы выросли.
              Отклонение фактического объёма до 10 % в обе стороны не меняет цену; больше — по факту через счёт или претензию.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">2. Обязательства клиента</h2>
            <p className="mt-1">
              Точный адрес с доступом для машины 3,5–12 т; лифт/этажи указаны честно; на объекте есть парковка
              или согласованная Halteverbotszone. Воскресенья и общегосударственные праздники — не рабочие дни
              (§ 9 ArbZG); переносы — по согласованию.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">3. Оплата</h2>
            <p className="mt-1">
              Аванс 30 % до даты переезда, остаток — после приёмки по счёту со сроком оплаты
              (по умолчанию 14 дней, § 271 BGB). При просрочке начисляются проценты по § 288 BGB;
              напоминания направляются по уровням (14 / 30 дней).
            </p>
          </section>
          <section>
            <h2 className="font-semibold">4. Ответственность перевозчика</h2>
            <p className="mt-1">
              Ответственность за повреждение имущества — по § 451 i.V.m. § 431 HGB, максимум 620 € за м³.
              Приёмка с цифровым протоколом (подпись, хеш-цепочка) фиксирует состояние груза.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">5. Претензии</h2>
            <p className="mt-1">
              Явные повреждения — не позднее 3 дней после приёмки, скрытые — не позднее 14 дней (§ 438 HGB).
              Регистрация претензии в разделе «Претензии» вашего кабинета или письмом на email из Impressum.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">6. Отмена (Widerruf)</h2>
            <p className="mt-1">
              Заявка, оформленная онлайн, — дистанционный договор: 14 дней на отмену (§§ 355, 357 BGB),
              детали на странице «Отмена». Отмена с согласованной датой ближе 72 ч — возможно
              возмещение понесённых расходов.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
