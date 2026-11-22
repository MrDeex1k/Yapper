import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { Invitations } from "@yapper/api";
import { api, APIError } from "./api";
import { errorText } from "./errors";
import { MessageRetention } from "./message-retention";

const invitationsKey = ["owner", "invitations"] as const;
const invitationDate = {
  en: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }),
  pl: new Intl.DateTimeFormat("pl", { dateStyle: "medium", timeStyle: "short" }),
};

export function AdmissionPanel({
  openAdmission,
  locale,
  onAdmissionChange,
  onClose,
}: {
  openAdmission: boolean;
  locale: Locale;
  onAdmissionChange: (open: boolean) => void;
  onClose: () => void;
}) {
  const t = messages[locale];
  const heading = useRef<HTMLHeadingElement>(null);
  const queryClient = useQueryClient();
  const invitations = useQuery({
    queryKey: invitationsKey,
    queryFn: ({ signal }) => api.invitations(signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });
  const [code, setCode] = useState<{ id: string; token: string } | null>(null);
  const [working, setWorking] = useState(false);
  const busy = working || invitations.isFetching;
  const [notice, setNotice] = useState<"admissionSaved" | "copied" | "invitationRevoked" | null>(
    null,
  );
  const [actionError, setActionError] = useState<unknown>(null);
  const error = actionError ?? invitations.error;
  const accessDenied =
    invitations.error instanceof APIError && [401, 403].includes(invitations.error.status);
  const items = accessDenied ? undefined : invitations.data?.invitations;
  const date = invitationDate[locale];

  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setWorking(true);
    setActionError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setActionError(failure);
    } finally {
      setWorking(false);
    }
  }

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: invitationsKey });
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      const invitation = await api.invite({
        expiresInHours: Number(data.get("expiresInHours")),
        maxUses: Number(data.get("maxUses")),
      });
      setCode(invitation);
      await refresh();
    });
  }

  return (
    <section
      id="admission-panel"
      className="inline-panel admission-panel"
      aria-labelledby="admission-title"
    >
      <header className="panel-heading">
        <h2 id="admission-title" ref={heading} tabIndex={-1}>
          {t.admissionSettings}
        </h2>
        <Button size="icon" variant="ghost" aria-label={t.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </Button>
      </header>
      <div className="admission-mode">
        <p>{openAdmission ? t.openAdmission : t.invitationOnly}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const settings = await api.setAdmission({ openAdmission: !openAdmission });
              onAdmissionChange(settings.openAdmission);
              setNotice("admissionSaved");
            })
          }
        >
          {openAdmission ? t.closeAdmission : t.openAdmissionAction}
        </Button>
      </div>
      <form className="entry-form admission-form" onSubmit={create}>
        <label>
          {t.invitationHours}
          <Input
            name="expiresInHours"
            type="number"
            defaultValue={24}
            required
            min={0}
            max={876000}
          />
        </label>
        <label>
          {t.invitationUses}
          <Input name="maxUses" type="number" defaultValue={1} required min={0} max={2147483647} />
        </label>
        <Button type="submit" size="sm" disabled={busy}>
          {t.createInvitation}
        </Button>
      </form>
      <p>{t.invitationUnlimitedHint}</p>
      {code && !accessDenied && !items?.some((item) => item.id === code.id && item.revoked) && (
        <>
          <p>{t.inviteNotice}</p>
          <div className="invite-code">
            <Input aria-label={t.invitation} value={code.token} readOnly />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(code.token);
                  setNotice("copied");
                })
              }
            >
              <Copy size={16} aria-hidden="true" /> {t.copy}
            </Button>
          </div>
        </>
      )}
      {error !== null && (
        <output className="error-message" role="alert">
          {errorText(error, locale)}
        </output>
      )}
      {notice && <output>{t[notice]}</output>}
      <div className="panel-heading admission-list-heading">
        <h3>{t.invitations}</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(refresh)}>
          {t.refreshInvitations}
        </Button>
      </div>
      {items?.length === 0 && <p>{t.noInvitations}</p>}
      {invitations.isPending && invitations.isFetching && <output>{t.loading}</output>}
      <ul className="admission-list">
        {items?.map((item) => (
          <li key={item.id}>
            <div>
              <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time>
              <span>
                {item.expiresAt
                  ? `${t.expiresAt} ${date.format(new Date(item.expiresAt))}`
                  : t.noExpiration}
              </span>
              <span>
                {item.remaining === null ? t.unlimitedUses : `${t.remainingUses} ${item.remaining}`}
              </span>
            </div>
            {item.revoked ? (
              <span>{t.invitationRevoked}</span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api.revokeInvitation(item.id);
                    setCode((current) => (current?.id === item.id ? null : current));
                    queryClient.setQueryData<Invitations>(
                      invitationsKey,
                      (previous) =>
                        previous && {
                          ...previous,
                          invitations: previous.invitations.map((invitation) =>
                            invitation.id === item.id
                              ? { ...invitation, revoked: true }
                              : invitation,
                          ),
                        },
                    );
                    setNotice("invitationRevoked");
                    await refresh();
                  })
                }
              >
                {t.revokeInvitation}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <MessageRetention locale={locale} />
    </section>
  );
}
