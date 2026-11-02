"use client";

// DE-копия delete-account.tsx (GDPR Art. 17) — тексты немецкие, экшен общий.

import { useState } from "react";
import { deleteAccountAction } from "@/lib/actions";

export function DeleteAccountDe() {
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
      setError(r.message ?? "Konto konnte nicht gelöscht werden.");
    } catch {
      setError("Netzwerkfehler. Bitte erneut versuchen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="mb-2 font-semibold">Konto löschen (Art. 17 DSGVO)</h2>
      <p className="mb-3 text-sm text-muted">
        Ihr Profil wird anonymisiert: E-Mail und Name werden gelöscht, aktive Anfragen sperren die Löschung.
        Dokumente mit Finanzdaten bleiben anonymisiert gespeichert (GoBD verlangt die Aufbewahrung von Rechnungen).
      </p>
      <label className="mb-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>Ich verstehe, dass die Löschung unwiderruflich ist, und möchte mein Konto löschen.</span>
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
        {pending ? "Wird gelöscht…" : "Konto löschen"}
      </button>
    </div>
  );
}
