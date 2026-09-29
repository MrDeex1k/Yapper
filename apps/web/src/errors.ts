import { messages, type Locale } from "@yapper/i18n";
import { APIError } from "./api";
export function errorText(error: unknown, locale: Locale): string {
  const t = messages[locale];
  if (!(error instanceof APIError)) return t.errorUnavailable;
  if (error.code === "login_failed") return t.errorLogin;
  if (error.code === "setup_denied") return t.errorSetup;
  if (error.code === "conflict") return t.errorConflict;
  if (error.status === 403 || error.status === 401) return t.errorAccess;
  if (error.status === 400 || error.status === 413 || error.status === 415) return t.errorInvalid;
  return t.errorUnavailable;
}
