"use client";

import { useState } from "react";
import { deleteAccountAction } from "@/lib/actions";

/**
 * GDPR ст. 17: удаление аккаунта с необратимым подтверждением.
 * Экшен анонимизирует данные (GoBD) и инвалидирует сессию; здесь — redirect на главную.
 */
export function DeleteAccount() {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setPending(true);
    setError(null);
    try {
      const r = await deleteAccountAction();
      if (r.ok) {
        window.location.href = "/?deleted=1";
        return;
      }
      setError(r.message ?? "Не удалось удалить аккаунт.");
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="mb-2 font-semibold">Удаление аккаунта (ст. 17 DSGVO)</h2>
      <p className="mb-3 text-sm text-muted">
        Ваш профиль будет обезличен: email и имя удаляются, активные заявки блокируют удаление.
        Документы с денежными данными сохраняются в обезличенном виде (GoBD требует хранения счетов).
      </p>
      <label className="mb-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>Я понимаю, что удаление необратимо, и хочу удалить свой аккаунт.</span>
      </label>
      {error && (
        <p className="mb-3 rounded-base border border-danger/30 bg-red-50 p-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-outline"
        disabled={!confirmed || pending}
        onClick={onSubmit}
      >
        {pending ? "Удаляю…" : "Удалить аккаунт"}
      </button>
    </div>
  );
}
