import type {
  CurrentUser,
  ChannelPatch,
  CreateChannelInput,
  CommunityState,
  GuestInput,
  SetupInput,
  Message,
  HistoryPage,
  MessageChanges,
  MessageEdit,
  MessageRetention,
  SendInput,
  AdmissionSettings,
  InvitationInput,
  Invitation,
  Invitations,
  MemberPage,
  ModerationAction,
  ModerationAudit,
  ModeratorInput,
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
async function withDeadline<T>(
  ms: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function fetchAccount<T>(
  path: string,
  init: RequestInit,
  consume: (response: Response) => T | Promise<T>,
  timeout = 8000,
) {
  return withDeadline(timeout, undefined, async (signal) => {
    const response = await fetch(path, { ...init, credentials: "same-origin", signal });
    return consume(response);
  });
}

async function refreshAccount() {
  const body = await fetchAccount("/api/auth/token", {}, (response) => {
    if (!response.ok) {
      token = null;
      throw new APIError("access_denied", response.status);
    }
    return response.json() as Promise<{ token: string }>;
  });
  token = body.token;
  refreshedAt = Date.now();
}
export async function restoreAccount() {
  const session = await fetchAccount("/api/auth/get-session", {}, (response) => {
    if (!response.ok) throw new APIError("service_unavailable", response.status);
    return response.json() as Promise<unknown>;
  });
  if (session) await refreshAccount();
  else token = null;
}
export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (token && Date.now() - refreshedAt > 240000) await refreshAccount();
  return withDeadline(10000, signal, async (requestSignal) => {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: requestSignal,
    });
    const result = (await response.json()) as T & { code?: string };
    if (!response.ok) throw new APIError(result.code ?? "service_unavailable", response.status);
    return result;
  });
}
export async function login(username: string, password: string) {
  await fetchAccount(
    "/api/auth/sign-in/username",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    },
    (response) => {
      if (!response.ok) throw new APIError("login_failed", response.status);
    },
    10000,
  );
  await refreshAccount();
}
export async function logout() {
  await fetchAccount(
    "/api/auth/sign-out",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
    (response) => {
      if (!response.ok) throw new APIError("service_unavailable", response.status);
    },
    10000,
  );
  token = null;
}
export const api = {
  state: () => request<CommunityState>("/api/v1/state"),
  me: (signal?: AbortSignal) => request<CurrentUser>("/api/v1/me", undefined, signal),
  setup: (body: SetupInput) => request<{ configured: boolean }>("/api/v1/setup", body),
  join: (body: GuestInput) => request("/api/v1/guests", body),
  setAdmission: (body: AdmissionSettings) => request<AdmissionSettings>("/api/v1/admission", body),
  invitations: (signal?: AbortSignal) =>
    request<Invitations>("/api/v1/invitations", undefined, signal),
  invite: (body: InvitationInput) => request<Invitation>("/api/v1/invitations", body),
  revokeInvitation: (id: string) => request(`/api/v1/invitations/${id}/revoke`, {}),
  saveCategory: (id: string, name: string) =>
    request(id ? `/api/v1/categories/${id}` : "/api/v1/categories", { name }),
  moveCategory: (id: string, direction: -1 | 1) =>
    request(`/api/v1/categories/${id}/move`, { direction }),
  createChannel: (body: CreateChannelInput) => request("/api/v1/channels", body),
  saveChannel: (id: string, body: ChannelPatch) =>
    request(`/api/v1/channels/${id}`, body, undefined, "PATCH"),
  moveChannel: (id: string, direction: -1 | 1) =>
    request(`/api/v1/channels/${id}/move`, { direction }),
  archiveChannel: (id: string) => request(`/api/v1/channels/${id}/archive`, {}),
  timeline: (channelId: string, beforeSequence: number, signal: AbortSignal) =>
    request<HistoryPage>(
      `/api/v1/channels/${channelId}/timeline?before=${beforeSequence}`,
      undefined,
      signal,
    ),
  messageChanges: (channelId: string, afterRevision: number, signal: AbortSignal) =>
    request<MessageChanges>(
      `/api/v1/channels/${channelId}/messages/changes?after=${afterRevision}`,
      undefined,
      signal,
    ),
  editMessage: (channel: string, id: string, input: MessageEdit) =>
    request(`/api/v1/channels/${channel}/messages/${id}/edit`, input),
  deleteMessage: (channel: string, id: string) =>
    request(`/api/v1/channels/${channel}/messages/${id}/delete`, {}),
  messageRetention: (signal: AbortSignal) =>
    request<MessageRetention>("/api/v1/message-retention", undefined, signal),
  setMessageRetention: (input: MessageRetention) =>
    request<MessageRetention>("/api/v1/message-retention", input),
  send: (channel: string, body: SendInput) =>
    request<Message>(`/api/v1/channels/${channel}/messages`, body),
  ticket: () => request<{ ticket: string }>("/api/v1/events/ticket", {}),
  members: ({
    after,
    target,
    signal,
  }: {
    after?: string;
    target?: string;
    signal?: AbortSignal;
  }) => {
    const params = new URLSearchParams();
    if (after) params.set("after", after);
    if (target) params.set("target", target);
    return request<MemberPage>(`/api/v1/participants?${params}`, undefined, signal);
  },
  audit: (signal?: AbortSignal) =>
    request<ModerationAudit>("/api/v1/moderation/audit", undefined, signal),
  provisionModerator: (body: ModeratorInput) => request("/api/v1/moderators", body),
  moderate: (id: string, body: ModerationAction) =>
    request(`/api/v1/participants/${id}/moderate`, body),
};
