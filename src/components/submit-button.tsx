"use client";

// Кнопка отправки формы с состоянием «Выполняется…» (useFormStatus — работает внутри <form>).
// Используется во всех server-action формах, чтобы пользователь видел, что действие идёт.

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, className = "btn btn-primary h-9" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className} aria-live="polite">
      {pending ? "Выполняется…" : children}
    </button>
  );
}
