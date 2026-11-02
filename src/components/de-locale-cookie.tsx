"use client";

/**
 * Ставит cookie locale=de при монтировании на DE-страницах без LocaleSwitch
 * (например /de/login), чтобы серверные редиректы (login/success → /de/*)
 * знали локаль пользователя.
 */
import { useEffect } from "react";

export function DeLocaleCookie() {
  useEffect(() => {
    const t = setTimeout(() => {
      document.cookie = "locale=de; path=/; max-age=31536000; samesite=lax";
    }, 0);
    return () => clearTimeout(t);
  }, []);
  return null;
}
