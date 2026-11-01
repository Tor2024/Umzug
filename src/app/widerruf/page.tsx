import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Отмена (Widerruf)",
  description: "Право отмены дистанционного договора: 14 дней, §§ 355/356 BGB, образец формулировки.",
};

/** Widerrufsbelehrung: §§ 355/356 BGB. Checkbox отказа в визарде по умолчанию НЕ отмечен. */
export default function WiderrufPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-3xl font-bold">Право отмены (Widerrufsrecht)</h1>
        <p className="mt-1 text-sm text-muted">Для потребителей при дистанционных договорах — §§ 355, 356 BGB.</p>

        <div className="card mt-6 space-y-5 p-6 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold">1. Право на отмену</h2>
            <p className="mt-1">
              Вы вправе отменить договор в течение 14 дней без объяснения причин. Срок начинается
              с момента заключения договора (подтверждение заявки онлайн).
            </p>
          </section>
          <section>
            <h2 className="font-semibold">2. Как отменить</h2>
            <p className="mt-1">
              Заявлением на email из Impressum с указанием номера заявки (например, «Я отменяю заявку MS-2026-…»).
              Достаточно отправки до истечения срока.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">3. Последствия отмены</h2>
            <p className="mt-1">
              Возвращаем всё полученное в течение 14 дней тем же способом. Если вы попросили начать
              услугу до конца срока отмены (§ 356 Abs. 4 BGB) и услуга оказана полностью,
              вы платите за фактически выполненный объём; при согласии на начало до истечения срока
              право отмены на этот объём утрачивается.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">4. Особый случай — близкая дата</h2>
            <p className="mt-1">
              При отмене менее чем за 72 часа до согласованной даты мы можем удержать фактически
              понесённые расходы (зарезервированная бригада и машина). Это не штраф, а компенсация — ст. 357 Abs. 3 BGB.
            </p>
          </section>
          <section>
            <h2 className="font-semibold">5. Форма отказа в визарде</h2>
            <p className="mt-1">
              В калькуляторе есть отдельный пункт «отказ от права отмены» (§ 356 Abs. 4 BGB):
              он <strong>не отмечен по умолчанию</strong> и нужен только если вы хотите,
              чтобы мы начали в день заявки. Без отметки вы сохраняете полное право отмены.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
