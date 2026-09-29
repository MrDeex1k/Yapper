import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Mic,
  MicOff,
  VolumeX,
  PhoneOff,
  Hash,
  Headphones,
  LogOut,
  Plus,
  Send,
  Shield,
  Volume2,
  X,
  ArrowRight,
  Check,
  Copy,
} from "lucide-react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { CommunityState, CurrentUser, Participant, Message } from "@yapper/api";
import { api, APIError, login, logout, restoreAccount } from "./api";
import { useConversation } from "./use-conversation";
import { useVoice } from "./use-voice";
import { errorText } from "./errors";
import "./style.css";

function initialLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("yapper.locale");
  } catch {
    /* Preferences may be unavailable in private contexts. */
  }
  return saved === "pl" || (saved !== "en" && navigator.language.startsWith("pl")) ? "pl" : "en";
}
function App() {
  const [locale, setLocale] = useState(initialLocale);
  const [state, setState] = useState<CommunityState | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [needsServer, setNeedsServer] = useState(false);
  const t = messages[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("yapper.locale", locale);
    } catch {
      /* Non-secret preference only. */
    }
  }, [locale]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (window.yapperDesktop && !(await window.yapperDesktop.getServer())) {
          if (active) {
            setNeedsServer(true);
            setLoading(false);
          }
          return;
        }
        const next = await api.state();
        if (!active) return;
        setState(next);
        if (next.configured) {
          await restoreAccount();
          try {
            const me = await api.me();
            if (active) setUser(me);
          } catch (e) {
            if (!(e instanceof APIError) || e.status !== 403) throw e;
          }
        }
      } catch (e) {
        if (active) setError(e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function enter() {
    setUser(await api.me());
    setState(await api.state());
  }
  const language = (
    <label className="locale-switch">
      {t.language}
      <select
        aria-label={t.language}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="en">EN</option>
        <option value="pl">PL</option>
      </select>
    </label>
  );
  if (needsServer)
    return (
      <div className="entry-shell">
        <header className="entry-header">
          <span className="wordmark">yapper.</span>
          {language}
        </header>
        <main className="entry-main">
          <section className="entry-content">
            <h1>{t.chooseServer}</h1>
            <p className="description">{t.serverAddressHint}</p>
            <form
              className="entry-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void window.yapperDesktop
                  ?.setServer(String(form.get("address") ?? ""))
                  .then(() => location.reload())
                  .catch(setError);
              }}
            >
              <label>
                {t.serverAddress}
                <Input name="address" required maxLength={2048} placeholder="voice.example.com" />
              </label>
              {error !== null && (
                <p className="error-message" role="alert">
                  {t.errorInvalid}
                </p>
              )}
              <Button type="submit">
                {t.connectServer}
                <ArrowRight size={18} />
              </Button>
            </form>
          </section>
        </main>
      </div>
    );
  if (loading)
    return (
      <main className="loading-screen">
        <span className="wordmark">yapper.</span>
        <output>{t.loading}</output>
      </main>
    );
  if (user && state)
    return (
      <Conversation
        key={user.participant.id}
        user={user}
        state={state}
        locale={locale}
        language={language}
        onSignOut={async () => {
          await logout();
          setUser(null);
        }}
      />
    );
  return (
    <div className="entry-shell">
      <header className="entry-header">
        <a href="/" className="wordmark">
          yapper<span>.</span>
        </a>
        {language}
      </header>
      <main className="entry-main">
        {error ? (
          <>
            <h1>{t.errorUnavailable}</h1>
            <Button onClick={() => location.reload()}>{t.reconnect}</Button>
          </>
        ) : (
          state && (
            <Entry
              locale={locale}
              state={state}
              onEnter={enter}
              onConfigured={async () => setState(await api.state())}
            />
          )
        )}
      </main>
      <footer className="entry-footer">
        {t.privacy}
        <span>{t.build}</span>
      </footer>
    </div>
  );
}

function Entry({
  locale,
  state,
  onEnter,
  onConfigured,
}: {
  locale: Locale;
  state: CommunityState;
  onEnter: () => Promise<void>;
  onConfigured: () => Promise<void>;
}) {
  const t = messages[locale];
  const [mode, setMode] = useState<"join" | "login">("join");
  const view = state.configured ? mode : "setup";
  const labels = {
    setup: [t.setup, t.setupDescription, t.createServer],
    join: [t.join, t.joinDescription, t.joinAction],
    login: [t.adminLogin, t.admin, t.signIn],
  }[view];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    setError(null);
    try {
      if (!state.configured) {
        await api.setup({
          token: field("token"),
          username: field("username"),
          password: field("password"),
          name: field("name"),
        });
        await onConfigured();
        setMode("login");
      } else if (mode === "login") {
        await login(field("username"), field("password"));
        await onEnter();
      } else {
        await api.join({ nickname: field("nickname"), invitation: field("invitation") });
        await onEnter();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="entry-content">
      <p className="eyebrow">{state.configured ? state.name : "YAPPER"}</p>
      <h1>{labels[0]}</h1>
      <p className="description">{labels[1]}</p>
      <form onSubmit={(event) => void submit(event)} className="entry-form">
        <EntryFields state={state} mode={mode} locale={locale} />
        {error !== null && (
          <p className="error-message" role="alert">
            {errorText(error, locale)}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? t.connecting : labels[2]}
          <ArrowRight size={18} aria-hidden="true" />
        </Button>
      </form>
      {state.configured && (
        <Button
          variant="ghost"
          onClick={() => {
            setMode(mode === "join" ? "login" : "join");
            setError(null);
          }}
        >
          {mode === "join" ? t.adminLogin : t.back}
        </Button>
      )}
      {state.configured && mode === "join" && <p className="identity-notice">{t.identityNotice}</p>}
    </section>
  );
}

function EntryFields({
  state,
  mode,
  locale,
}: {
  state: CommunityState;
  mode: "join" | "login";
  locale: Locale;
}) {
  const t = messages[locale];
  return (
    <>
      {!state.configured && (
        <>
          <label>
            {t.setupToken}
            <Input name="token" type="password" required autoComplete="off" maxLength={128} />
          </label>
          <label>
            {t.communityName}
            <Input name="name" required maxLength={64} autoComplete="organization" />
          </label>
        </>
      )}
      {!state.configured || mode === "login" ? (
        <>
          <label>
            {t.username}
            <Input
              name="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
              autoComplete="username"
            />
          </label>
          <label>
            {t.password}
            <Input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete={state.configured ? "current-password" : "new-password"}
              aria-describedby={!state.configured ? "password-hint" : undefined}
            />
          </label>
          {!state.configured && (
            <p id="password-hint" className="field-hint">
              {t.passwordHint}
            </p>
          )}
        </>
      ) : (
        <>
          <label>
            {t.nickname}
            <Input name="nickname" required maxLength={32} autoComplete="nickname" />
          </label>
          {!state.openAdmission && (
            <label>
              {t.invitation}
              <Input name="invitation" required maxLength={128} autoComplete="off" />
            </label>
          )}
        </>
      )}
    </>
  );
}

function Conversation({
  user,
  state,
  locale,
  language,
  onSignOut,
}: {
  user: CurrentUser;
  state: CommunityState;
  locale: Locale;
  language: React.ReactNode;
  onSignOut: () => Promise<void>;
}) {
  const t = messages[locale];
  const textChannels = user.channels.filter((c) => c.kind === "text");
  const [channel, setChannel] = useState(textChannels[0]?.id ?? "");
  const current = textChannels.find((c) => c.id === channel);
  const conversation = useConversation(channel);
  const voice = useVoice();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ requestId: string; body: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invitation, setInvitation] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [banTarget, setBanTarget] = useState<Participant | null>(null);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || !draft.trim()) return;
    const input =
      pending && pending.body === draft.trim()
        ? pending
        : { requestId: crypto.randomUUID(), body: draft.trim() };
    setPending(input);
    setSending(true);
    setError(null);
    try {
      const message = await api.send(channel, input);
      conversation.append(message);
      setDraft("");
      setPending(null);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  }
  async function invite() {
    setError(null);
    try {
      setInvitation((await api.invite()).token);
      setCopied(false);
    } catch (e) {
      setError(e);
    }
  }
  async function ban() {
    if (!banTarget) return;
    try {
      await api.ban(banTarget.id);
      setBanTarget(null);
    } catch (e) {
      setError(e);
    }
  }
  function switchChannel(id: string) {
    if (id === channel) return;
    setChannel(id);
    setDraft("");
    setPending(null);
    setError(null);
  }
  return (
    <div className="workspace chat-workspace">
      <ConversationSidebar
        user={user}
        state={state}
        locale={locale}
        channel={channel}
        voice={voice}
        onChannel={switchChannel}
        onInvite={invite}
        onSignOut={onSignOut}
        onError={setError}
      />
      <main className="conversation">
        <header className="topbar">
          <div className="channel-title">
            <Hash size={20} />
            <strong>{current?.name}</strong>
            <span className="channel-separator" />
            <span className="channel-subtitle">{state.name}</span>
          </div>
          {language}
        </header>
        <div className="connection-bar">
          <span
            className={
              conversation.status === "connected" ? "status-dot" : "status-dot status-warning"
            }
          />
          <output>{t[conversation.status]}</output>
        </div>
        {invitation && (
          <section className="inline-panel" aria-label={t.inviteFriend}>
            <div className="panel-heading">
              <strong>{t.inviteFriend}</strong>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t.close}
                onClick={() => setInvitation(null)}
              >
                <X size={16} />
              </Button>
            </div>
            <p>{t.inviteNotice}</p>
            <div className="invite-code">
              <Input aria-label={t.invitation} value={invitation} readOnly />
              <Button
                variant="outline"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(invitation)
                    .then(() => setCopied(true))
                    .catch(setError)
                }
              >
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t.copied : t.copy}
              </Button>
            </div>
          </section>
        )}
        {banTarget && (
          <section className="inline-panel" aria-labelledby="ban-title">
            <strong id="ban-title" role="alert">
              {t.confirmBan}
            </strong>
            <p>{banTarget.nickname}</p>
            <div className="panel-actions">
              <Button variant="destructive" onClick={() => void ban()}>
                {t.confirm}
              </Button>
              <Button variant="ghost" onClick={() => setBanTarget(null)}>
                {t.cancel}
              </Button>
            </div>
          </section>
        )}
        <MessageHistory
          items={conversation.messages}
          user={user}
          locale={locale}
          onBan={setBanTarget}
        />
        <div className="composer-area">
          {(error ?? conversation.error) !== null && (
            <p role="alert" className="error-message">
              {errorText(error ?? conversation.error, locale)}
            </p>
          )}
          <form className="composer" onSubmit={(event) => void send(event)}>
            <textarea
              aria-label={t.messagePlaceholder}
              placeholder={`${t.messagePlaceholder} #${current?.name ?? ""}`}
              value={draft}
              maxLength={2000}
              rows={2}
              disabled={sending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(event);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !draft.trim()}
              aria-label={sending ? t.sending : pending ? t.retrySend : t.send}
            >
              <Send size={19} />
            </Button>
          </form>
          <p className="composer-hint">
            {t.privacy}
            <Headphones size={13} aria-hidden="true" />
          </p>
        </div>
      </main>
    </div>
  );
}
function ConversationSidebar({
  user,
  state,
  locale,
  channel,
  voice,
  onChannel,
  onInvite,
  onSignOut,
  onError,
}: {
  user: CurrentUser;
  state: CommunityState;
  locale: Locale;
  channel: string;
  voice: ReturnType<typeof useVoice>;
  onChannel: (id: string) => void;
  onInvite: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const t = messages[locale];
  const textChannels = user.channels.filter((c) => c.kind === "text");
  const voiceChannels = user.channels.filter((c) => c.kind === "voice");
  return (
    <aside className="sidebar" aria-label={t.channels}>
      <a className="wordmark" href="/">
        yapper<span>.</span>
      </a>
      <div className="server-heading">
        <div className="server-avatar">{state.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <strong>{state.name}</strong>
          <p>{t.privacy}</p>
        </div>
      </div>
      <p className="section-label">{t.textChannels}</p>
      <nav className="channel-list" aria-label={t.textChannels}>
        {textChannels.map((c) => (
          <Button
            key={c.id}
            variant="ghost"
            className={c.id === channel ? "channel-button channel-active" : "channel-button"}
            aria-current={c.id === channel ? "page" : undefined}
            onClick={() => onChannel(c.id)}
          >
            <Hash size={18} />
            {c.name}
          </Button>
        ))}
      </nav>
      <p className="section-label">{t.voiceChannels}</p>
      <nav className="channel-list" aria-label={t.voiceChannels}>
        {voiceChannels.map((c) => (
          <Button
            key={c.id}
            variant="ghost"
            className="channel-button"
            onClick={() => void voice.join(c.id)}
            disabled={voice.status === "connecting"}
            title={t.joinVoice}
          >
            <Volume2 size={18} />
            {c.name}
          </Button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <VoicePanel voice={voice} voiceChannels={voiceChannels} locale={locale} onError={onError} />
        {user.participant.role === "owner" && (
          <Button variant="outline" onClick={() => void onInvite()}>
            <Plus size={16} />
            {t.inviteFriend}
          </Button>
        )}
        <div className="self-row">
          <span className="person-avatar">
            {user.participant.nickname.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.participant.nickname}</strong>
            <small>{t[user.participant.role]}</small>
          </div>
          {user.participant.role !== "participant" && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.signOut}
              onClick={() => void onSignOut().catch(onError)}
            >
              <LogOut size={17} />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function VoicePanel({
  voice,
  voiceChannels,
  locale,
  onError,
}: {
  voice: ReturnType<typeof useVoice>;
  voiceChannels: CurrentUser["channels"];
  locale: Locale;
  onError: (error: unknown) => void;
}) {
  const t = messages[locale];
  return (
    <>
      {voice.channel && (
        <section className="voice-panel" aria-label={t.voice}>
          <div className="voice-panel-title">
            <Volume2 size={15} />
            <strong>{voiceChannels.find((c) => c.id === voice.channel)?.name}</strong>
            <span>{t[voice.status]}</span>
          </div>
          {voice.participants.map((p) => (
            <div
              key={p.identity}
              className={p.speaking ? "voice-person voice-speaking" : "voice-person"}
            >
              <span className="status-dot" />
              {p.name}
            </div>
          ))}
          <div className="voice-controls">
            <Button
              size="icon"
              variant="ghost"
              aria-label={voice.muted ? t.unmute : t.mute}
              aria-pressed={!voice.muted}
              onClick={() => void voice.toggleMute()}
            >
              {voice.muted ? <MicOff size={17} /> : <Mic size={17} />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={voice.deafened ? t.undeafen : t.deafen}
              aria-pressed={voice.deafened}
              onClick={voice.toggleDeafen}
            >
              {voice.deafened ? <VolumeX size={17} /> : <Headphones size={17} />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t.leaveVoice}
              onClick={() => void voice.leave().catch(onError)}
            >
              <PhoneOff size={17} />
            </Button>
          </div>
          {voice.audioBlocked && (
            <Button variant="outline" onClick={() => void voice.startAudio()}>
              {t.undeafen}
            </Button>
          )}
        </section>
      )}
      {voice.error && (
        <p role="alert" className="error-message">
          {t.voiceError}
        </p>
      )}
    </>
  );
}

const timeFormatters = {
  en: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }),
  pl: new Intl.DateTimeFormat("pl", { hour: "2-digit", minute: "2-digit" }),
};
function MessageHistory({
  items,
  user,
  locale,
  onBan,
}: {
  items: Message[];
  user: CurrentUser;
  locale: Locale;
  onBan: (participant: Participant) => void;
}) {
  const t = messages[locale];
  return (
    <section
      className="message-history"
      aria-label={t.channels}
      aria-live="polite"
      aria-relevant="additions"
    >
      {items.length === 0 ? (
        <div className="empty-chat">
          <div className="empty-symbol">
            <Hash size={32} />
          </div>
          <h2>{t.emptyChat}</h2>
          <p>{t.emptyChatDescription}</p>
        </div>
      ) : (
        items.map((message) => (
          <article className="message-row" key={message.id}>
            <span className="person-avatar">{message.nickname.slice(0, 1).toUpperCase()}</span>
            <div className="message-content">
              <header>
                <strong>{message.nickname}</strong>
                {message.authorId === user.participant.id && (
                  <span className="you-label">{t.you}</span>
                )}
                <time dateTime={message.createdAt}>
                  {timeFormatters[locale].format(new Date(message.createdAt))}
                </time>
                {user.participant.role === "owner" && message.authorId !== user.participant.id && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`${t.ban}: ${message.nickname}`}
                    onClick={() =>
                      onBan({
                        id: message.authorId,
                        nickname: message.nickname,
                        role: "participant",
                      })
                    }
                  >
                    <Shield size={14} />
                  </Button>
                )}
              </header>
              <p>{message.body}</p>
            </div>
          </article>
        ))
      )}
    </section>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
