import type {
  CurrentUser,
  CommunityState,
  GuestInput,
  SetupInput,
  Message,
  SendInput,
} from "@yapper/api";
let token: string | null = null;
let refreshedAt = 0;
export class APIError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
async function refreshAccount() {
  const response = await fetch("/api/auth/token", {
    credentials: "same-origin",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    token = null;
    throw new APIError("access_denied", response.status);
  }
  const body = (await response.json()) as { token: string };
  token = body.token;
  refreshedAt = Date.now();
}
export async function restoreAccount() {
  const response = await fetch("/api/auth/get-session", {
    credentials: "same-origin",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new APIError("service_unavailable", response.status);
  const session: unknown = await response.json();
  if (session) await refreshAccount();
  else token = null;
}
export async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (token && Date.now() - refreshedAt > 240000) await refreshAccount();
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ?? AbortSignal.timeout(10000),
  });
  const result = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new APIError(result.code ?? "service_unavailable", response.status);
  return result;
}
export async function login(username: string, password: string) {
  const response = await fetch("/api/auth/sign-in/username", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new APIError("login_failed", response.status);
  await refreshAccount();
}
export async function logout() {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new APIError("service_unavailable", response.status);
  token = null;
}
export const api = {
  state: () => request<CommunityState>("/api/v1/state"),
  me: () => request<CurrentUser>("/api/v1/me"),
  setup: (body: SetupInput) => request<{ configured: boolean }>("/api/v1/setup", body),
  join: (body: GuestInput) => request("/api/v1/guests", body),
  invite: () => request<{ token: string }>("/api/v1/invitations", {}),
  history: (channel: string, after: number, signal?: AbortSignal) =>
    request<{ messages: Message[] }>(
      `/api/v1/channels/${channel}/messages?after=${after}`,
      undefined,
      signal,
    ),
  send: (channel: string, body: SendInput) =>
    request<Message>(`/api/v1/channels/${channel}/messages`, body),
  ticket: () => request<{ ticket: string }>("/api/v1/events/ticket", {}),
  ban: (id: string) => request(`/api/v1/participants/${id}/ban`, {}),
};
