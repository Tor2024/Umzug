"use client";

// Кнопка отправки формы с состоянием «Выполняется…» (useFormStatus — работает внутри <form>).
// Используется во всех server-action формах, чтобы пользователь видел, что действие идёт.
// Локаль: авто-детект по пути (/de/… → de), locale prop — опциональный оверрайд.

import { useFormStatus } from "react-dom";
import { usePathname } from "next/navigation";

const T = {
  ru: "Выполняется…",
  de: "Wird ausgeführt…",
} as const;

export function SubmitButton({
  children,
  className = "btn btn-primary h-9",
  locale,
}: {
  children: React.ReactNode;
  className?: string;
  locale?: "ru" | "de";
}) {
  const pathname = usePathname();
  const lang = locale ?? (pathname?.startsWith("/de") ? "de" : "ru");
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-live="polite">
      {pending ? T[lang] : children}
    </button>
  );
}
