import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Hash, Pencil, Shield, Trash2 } from "lucide-react";
import { Button } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { CurrentUser, Message } from "@yapper/api";
import { api } from "./api";
import { errorText } from "./errors";
import { isStaff } from "./moderation-panel";

const timeFormatters = {
  en: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }),
  pl: new Intl.DateTimeFormat("pl", { hour: "2-digit", minute: "2-digit" }),
};

export function MessageHistory({
  items,
  user,
  locale,
  archived,
  locked,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onChanged,
  onModerate,
}: {
  items: Message[];
  user: CurrentUser;
  locale: Locale;
  archived: boolean;
  locked: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onChanged: (channel: string) => void;
  onModerate: (id: string) => void;
}) {
  const t = messages[locale];
  const history = useRef<HTMLElement>(null);
  const followLatest = useRef(true);
  useLayoutEffect(() => {
    const node = history.current;
    if (node && followLatest.current) node.scrollTop = node.scrollHeight;
  }, [items]);
  return (
    <section
      ref={history}
      className="message-history"
      aria-label={t.messageHistory}
      aria-live="polite"
      aria-relevant="additions text"
      onScroll={(event) => {
        const node = event.currentTarget;
        followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
      }}
    >
      {hasOlder && (
        <div className="history-pagination">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked || loadingOlder}
            onClick={() => {
              followLatest.current = false;
              onLoadOlder();
            }}
          >
            {loadingOlder ? t.loading : t.loadOlder}
          </Button>
        </div>
      )}
      {items.length === 0 && !hasOlder && (
        <div className="empty-chat">
          <div className="empty-symbol">
            <Hash size={32} />
          </div>
          <h2>{t.emptyChat}</h2>
          <p>{t.emptyChatDescription}</p>
        </div>
      )}
      {items.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          locale={locale}
          own={message.authorId === user.participant.id}
          staff={isStaff(user.participant)}
          archived={archived}
          locked={locked}
          onChanged={onChanged}
          onModerate={onModerate}
        />
      ))}
    </section>
  );
}

type Action = { kind: "edit"; body: string; revision: number } | { kind: "delete" };

function validEdit(body: string) {
  const length = Array.from(body.trim()).length;
  return length >= 1 && length <= 2000;
}

function MessageRow({
  message,
  locale,
  own,
  staff,
  archived,
  locked,
  onChanged,
  onModerate,
}: {
  message: Message;
  locale: Locale;
  own: boolean;
  staff: boolean;
  archived: boolean;
  locked: boolean;
  onChanged: (channel: string) => void;
  onModerate: (id: string) => void;
}) {
  const t = messages[locale];
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const form = useRef<HTMLFormElement>(null);
  const previousTrigger = useRef<HTMLElement | null>(null);
  const actionKind = action?.kind;
  const newRevision = action?.kind === "edit" && action.revision !== message.revision;
  useEffect(() => {
    if (actionKind) form.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [actionKind]);
  function open(next: Action, trigger: HTMLElement) {
    previousTrigger.current = trigger;
    setError(null);
    setAction(next);
  }
  function cancel() {
    setError(null);
    setAction(null);
    previousTrigger.current?.focus();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy || locked) return;
    if (action.kind === "edit" && (archived || !validEdit(action.body) || newRevision)) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "edit") {
        await api.editMessage(message.channelId, message.id, {
          body: action.body.trim(),
          revision: action.revision,
        });
      } else {
        await api.deleteMessage(message.channelId, message.id);
      }
      onChanged(message.channelId);
      cancel();
    } catch (e) {
      setError(e);
      onChanged(message.channelId);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="message-row">
      <span className="person-avatar">{message.nickname.slice(0, 1).toUpperCase()}</span>
      <div className="message-content">
        <header>
          <strong>{message.nickname}</strong>
          {own && <span className="you-label">{t.you}</span>}
          <time dateTime={message.createdAt}>
            {timeFormatters[locale].format(new Date(message.createdAt))}
          </time>
          {message.editedAt && <small>{t.messageEdited}</small>}
          {staff && !own && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${t.moderateParticipant}: ${message.nickname}`}
              onClick={() => onModerate(message.authorId)}
            >
              <Shield size={14} />
            </Button>
          )}
          {own && !archived && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.editMessage}
              disabled={locked || busy}
              onClick={(e) =>
                open(
                  { kind: "edit", body: message.body, revision: message.revision },
                  e.currentTarget,
                )
              }
            >
              <Pencil size={14} aria-hidden="true" />
            </Button>
          )}
          {(own || staff) && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.deleteMessage}
              disabled={locked || busy}
              onClick={(e) => open({ kind: "delete" }, e.currentTarget)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          )}
        </header>
        {action?.kind !== "edit" && <p>{message.body}</p>}
        {action && (
          <MessageActionForm
            form={form}
            action={action}
            locale={locale}
            busy={busy}
            locked={locked}
            archived={archived}
            error={error}
            newerBody={newRevision ? message.body : null}
            onUseLatest={() => {
              setError(null);
              setAction((current) =>
                current?.kind === "edit" ? { ...current, revision: message.revision } : current,
              );
            }}
            onBody={(body) =>
              setAction((current) => (current?.kind === "edit" ? { ...current, body } : current))
            }
            onCancel={cancel}
            onSave={save}
          />
        )}
      </div>
    </article>
  );
}

function MessageActionForm({
  form,
  action,
  locale,
  busy,
  locked,
  archived,
  error,
  newerBody,
  onUseLatest,
  onBody,
  onCancel,
  onSave,
}: {
  form: React.RefObject<HTMLFormElement | null>;
  action: Action;
  locale: Locale;
  busy: boolean;
  locked: boolean;
  archived: boolean;
  error: unknown;
  newerBody: string | null;
  onUseLatest: () => void;
  onBody: (body: string) => void;
  onCancel: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const t = messages[locale];
  return (
    <form className="message-action" ref={form} onSubmit={(event) => void onSave(event)}>
      {action.kind === "edit" ? (
        <textarea
          aria-label={t.editMessage}
          data-autofocus
          value={action.body}
          aria-invalid={Array.from(action.body.trim()).length > 2000}
          disabled={busy || locked || archived}
          rows={2}
          onChange={(event) => onBody(event.target.value)}
        />
      ) : (
        <p>{t.confirmMessageDelete}</p>
      )}
      {action.kind === "edit" && Array.from(action.body.trim()).length > 2000 && (
        <p role="alert">{t.messageLengthError}</p>
      )}
      {newerBody !== null && (
        <>
          <output>
            {t.latestMessage}: {newerBody}
          </output>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || locked || archived}
            onClick={onUseLatest}
          >
            {t.editUsingLatest}
          </Button>
        </>
      )}
      <div className="panel-actions">
        <Button
          type="submit"
          size="sm"
          variant={action.kind === "delete" ? "destructive" : "default"}
          disabled={
            busy ||
            locked ||
            (action.kind === "edit" && (archived || !validEdit(action.body) || newerBody !== null))
          }
        >
          {action.kind === "delete" ? t.deleteMessage : t.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onCancel}
          data-autofocus={action.kind === "delete" ? true : undefined}
        >
          {t.cancel}
        </Button>
      </div>
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
    </form>
  );
}
