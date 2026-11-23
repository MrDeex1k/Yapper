import { messages, type Locale } from "@yapper/i18n";
import { APIError } from "./api";
export function errorText(error: unknown, locale: Locale): string {
  const t = messages[locale];
  if (!(error instanceof APIError)) return t.errorUnavailable;
  if (error.code === "login_failed") return t.errorLogin;
  if (error.code === "setup_denied") return t.errorSetup;
  if (error.code === "participant_banned") return t.participantBanned;
  if (error.code === "ip_blocked") return t.addressBlocked;
  if (error.code === "ip_unavailable") return t.addressUnavailable;
  if (error.code === "message_gone") return t.messageGone;
  if (error.code === "try_later" || error.status === 429) return t.errorRateLimit;
  if (error.code === "conflict") return t.errorConflict;
  if (error.status === 403 || error.status === 401) return t.errorAccess;
  if (error.status === 400 || error.status === 413 || error.status === 415) return t.errorInvalid;
  return t.errorUnavailable;
}
