import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type {
  Member,
  MemberPage,
  ModerationAction,
  ModerationAudit,
  Participant,
} from "@yapper/api";
import { APIError, api } from "./api";
import { errorText } from "./errors";

export function isStaff(participant: Participant) {
  return participant.role === "owner" || participant.role === "moderator";
}

const actionLabel = {
  kick: "kick",
  ban: "ban",
  unban: "unban",
  mute: "forceMute",
  unmute: "liftMute",
  grant_moderator: "grantModerator",
  revoke_moderator: "revokeModerator",
  provision_moderator: "provisionModerator",
  delete_message: "deleteMessage",
} as const;

export function ModerationPanel({
  actor,
  locale,
  target,
  revision,
  onClose,
}: {
  actor: Participant;
  locale: Locale;
  target: { id: string; request: number };
  revision: number;
  onClose: () => void;
}) {
  const t = messages[locale];
  const title = useRef<HTMLHeadingElement>(null);
  const [page, setDirectory] = useState<{ generation: string; data: MemberPage } | null>(null);
  const [events, setEvents] = useState<ModerationAudit["events"]>([]);
  const [selection, setSelection] = useState({ id: target.id, request: target.request, choice: 0 });
  const selected = selection.request === target.request ? selection.id : target.id;
  const selectionKey = [target.request, selection.choice].join("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryRetry, setDirectoryRetry] = useState(0);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [pinned, setPinned] = useState<{
    generation: string;
    selectionKey: string;
    member: Member | null;
  } | null>(null);
  const [auditError, setAuditError] = useState<unknown>(null);
  const [auditReload, setAuditReload] = useState(0);
  const generation = [revision, reload, directoryRetry].join("/");
  const activeGeneration = useRef(generation);
  useLayoutEffect(() => {
    activeGeneration.current = generation;
  }, [generation]);
  const directory = page?.generation === generation ? page.data : null;
  useEffect(() => {
    title.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api
      .members({ signal })
      .then((data) => {
        if (signal.aborted) return;
        setDirectory({ generation, data });
        setDirectoryError(false);
      })
      .catch(() => {
        if (!signal.aborted) setDirectoryError(true);
      });
    return () => controller.abort();
  }, [generation]);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api
      .audit(signal)
      .then((audit) => {
        if (signal.aborted) return;
        setEvents(audit.events);
        setAuditError(null);
      })
      .catch((e) => {
        if (!signal.aborted) setAuditError(e);
      });
    return () => controller.abort();
  }, [revision, reload, auditReload]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const { signal } = controller;
    void api
      .members({ target: selected, signal })
      .then((page) => {
        if (!signal.aborted)
          setPinned({ generation, selectionKey, member: page.members[0] ?? null });
      })
      .catch((e) => {
        if (!signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [selected, generation, selectionKey]);

  async function change(submit: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await submit();
      setReload((value) => value + 1);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadMore() {
    if (busy || !directory?.next) return;
    setBusy(true);
    setError(null);
    const { next } = directory;
    try {
      const more = await api.members({ after: next });
      if (activeGeneration.current !== generation) return;
      setDirectory((current) => {
        if (current?.generation !== generation || current.data.next !== next) return current;
        return {
          generation,
          data: { members: [...current.data.members, ...more.members], next: more.next },
        };
      });
    } catch (e) {
      if (activeGeneration.current === generation) setError(e);
    } finally {
      setBusy(false);
    }
  }
  const members = directory?.members ?? [];
  const confirmedPin =
    pinned?.generation === generation && pinned.selectionKey === selectionKey
      ? pinned.member
      : null;
  const selectedMember = members.find((member) => member.id === selected) ?? confirmedPin;
  const extra =
    selectedMember && !members.some((member) => member.id === selectedMember.id)
      ? selectedMember
      : null;
  return (
    <section
      className="inline-panel admission-panel moderation-panel"
      id="moderation-panel"
      aria-labelledby="moderation-title"
    >
      <div className="admission-mode">
        <h2 id="moderation-title" ref={title} tabIndex={-1}>
          {t.moderation}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
      {actor.role === "owner" && <ModeratorForm locale={locale} busy={busy} onSubmit={change} />}
      <div className="moderation-picker">
        <label>
          {t.chooseParticipant}
          <select
            value={selected}
            disabled={busy || !directory}
            onChange={(e) => {
              const id = e.target.value;
              setSelection(({ choice }) => ({ id, request: target.request, choice: choice + 1 }));
            }}
          >
            <option value="">{t.selectParticipant}</option>
            {(extra ? [extra, ...members] : members).map((member) => (
              <option key={member.id} value={member.id}>
                {member.nickname} ({t[member.role]}){member.banned ? ` · ${t.banned}` : ""}
              </option>
            ))}
          </select>
        </label>
        {directory?.next && (
          <Button variant="outline" onClick={() => void loadMore()} disabled={busy}>
            {t.moreParticipants}
          </Button>
        )}
      </div>
      {directoryError && (
        <div className="panel-actions">
          <p className="error-message" role="alert">
            {t.participantDirectoryLoadFailed}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setDirectoryError(false);
              setDirectoryRetry((value) => value + 1);
            }}
          >
            {t.retryParticipants}
          </Button>
        </div>
      )}
      {selectedMember && (
        <MemberActions
          key={selectedMember.id}
          member={selectedMember}
          actor={actor}
          locale={locale}
          busy={busy}
          onAction={(input) => change(() => api.moderate(selectedMember.id, input))}
        />
      )}
      <AuditList events={events} members={members} locale={locale} />
      {auditError !== null && (
        <div className="panel-actions">
          <p className="error-message" role="alert">
            {t.auditLoadFailed}
          </p>
          <Button variant="outline" onClick={() => setAuditReload((value) => value + 1)}>
            {t.retryLoad}
          </Button>
        </div>
      )}
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
      {saved && <output>{t.moderationSaved}</output>}
    </section>
  );
}

function ModeratorForm({
  locale,
  busy,
  onSubmit,
}: {
  locale: Locale;
  busy: boolean;
  onSubmit: (submit: () => Promise<unknown>) => Promise<void>;
}) {
  const t = messages[locale];
  function provision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void onSubmit(async () => {
      const password = String(data.get("password"));
      const length = Array.from(password).length;
      if (length < 12 || length > 128) throw new APIError("invalid_request", 400);
      await api.provisionModerator({ username: String(data.get("username")), password });
      form.reset();
    });
  }
  return (
    <details>
      <summary>{t.provisionModerator}</summary>
      <form className="moderator-form" onSubmit={provision}>
        <label>
          {t.username}
          <Input
            name="username"
            required
            pattern="[a-zA-Z0-9_]{3,32}"
            maxLength={32}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label>
          {t.password}
          <Input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            disabled={busy}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {t.create}
        </Button>
      </form>
      <p>{t.moderatorCredentialsNotice}</p>
    </details>
  );
}

function MemberActions({
  member,
  actor,
  locale,
  busy,
  onAction,
}: {
  member: Member;
  actor: Participant;
  locale: Locale;
  busy: boolean;
  onAction: (input: ModerationAction) => Promise<void>;
}) {
  const t = messages[locale];
  const [confirm, setConfirm] = useState<"kick" | "ban" | null>(null);
  const [blockIp, setBlockIp] = useState(false);
  if (
    member.id === actor.id ||
    member.role === "owner" ||
    (actor.role === "moderator" && member.role === "moderator")
  )
    return <p>{t.noModerationActions}</p>;
  if (member.banned) {
    return (
      <div className="moderation-target">
        <p>{member.ipBlocked ? t.bannedWithIp : t.banned}</p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void onAction({ action: "unban" })}
        >
          {t.unban}
        </Button>
      </div>
    );
  }
  if (confirm) {
    return (
      <div className="moderation-target">
        <p role="alert">{confirm === "ban" ? t.confirmBan : t.confirmKick}</p>
        {confirm === "ban" && <p>{t.anonymousBanNotice}</p>}
        {confirm === "ban" && member.canBlockIp && (
          <label className="moderation-check">
            <input
              type="checkbox"
              checked={blockIp}
              onChange={(e) => setBlockIp(e.target.checked)}
              disabled={busy}
            />
            {t.blockIp}
          </label>
        )}
        <div className="panel-actions">
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              const action = confirm;
              setConfirm(null);
              void onAction({ action, ...(action === "ban" ? { blockIp } : {}) });
            }}
          >
            {t.confirm}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
            {t.cancel}
          </Button>
        </div>
      </div>
    );
  }
  const mute = member.micMuted ? "unmute" : "mute";
  const role = member.role === "moderator" ? "revoke_moderator" : "grant_moderator";
  return (
    <div className="panel-actions moderation-target">
      <Button variant="outline" disabled={busy} onClick={() => setConfirm("kick")}>
        {t.kick}
      </Button>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setBlockIp(false);
          setConfirm("ban");
        }}
      >
        {t.ban}
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => void onAction({ action: mute })}>
        {t[actionLabel[mute]]}
      </Button>
      {actor.role === "owner" && member.registered && (
        <Button variant="outline" disabled={busy} onClick={() => void onAction({ action: role })}>
          {t[actionLabel[role]]}
        </Button>
      )}
    </div>
  );
}

function AuditList({
  events,
  members,
  locale,
}: {
  events: ModerationAudit["events"];
  members: Member[];
  locale: Locale;
}) {
  const t = messages[locale];
  const names = new Map(members.map((member) => [member.id, member.nickname]));
  return (
    <details className="moderation-audit">
      <summary>{t.moderationAudit}</summary>
      {events.length === 0 ? (
        <p>{t.noModerationEvents}</p>
      ) : (
        <ul className="admission-list">
          {events.map((event) => (
            <li
              key={`${event.createdAt}-${event.actorId}-${event.targetId}-${event.action}-${event.messageId ?? ""}`}
            >
              <div>
                <strong>{t[actionLabel[event.action]]}</strong>
                <span title={`${event.actorId} → ${event.targetId}`}>
                  {names.get(event.actorId) ?? event.actorId.slice(0, 8)} →{" "}
                  {names.get(event.targetId) ?? event.targetId.slice(0, 8)}
                </span>
                {event.ipBlocked && <span>{t.addressBlocked}</span>}
              </div>
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString(locale)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
