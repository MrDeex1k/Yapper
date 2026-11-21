import { useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, X } from "lucide-react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { InvitationSummary } from "@yapper/api";
import { api } from "./api";
import { errorText } from "./errors";
import { MessageRetention } from "./message-retention";

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
  const [items, setItems] = useState<InvitationSummary[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<"admissionSaved" | "copied" | "invitationRevoked" | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    heading.current?.focus();
    const controller = new AbortController();
    void api
      .invitations(AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
      .then(({ invitations }) => {
        if (controller.signal.aborted) return;
        setItems(invitations);
        setLoaded(true);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setItems((await api.invitations()).invitations);
    setLoaded(true);
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      const { token } = await api.invite({
        expiresInHours: Number(data.get("expiresInHours")),
        maxUses: Number(data.get("maxUses")),
      });
      setCode(token);
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
      {code && (
        <>
          <p>{t.inviteNotice}</p>
          <div className="invite-code">
            <Input aria-label={t.invitation} value={code} readOnly />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(code);
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
      {loaded && items.length === 0 && <p>{t.noInvitations}</p>}
      {!loaded && busy && <output>{t.loading}</output>}
      <ul className="admission-list">
        {items.map((item) => (
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
                    setItems((previous) =>
                      previous.map((invitation) =>
                        invitation.id === item.id ? { ...invitation, revoked: true } : invitation,
                      ),
                    );
                    setNotice("invitationRevoked");
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
