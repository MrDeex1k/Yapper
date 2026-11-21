import {
  Fragment,
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Hash, LogOut, Send, Settings, Volume2 } from "lucide-react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { CommunityState, CurrentUser } from "@yapper/api";
import { api, APIError, login, logout, restoreAccount } from "./api";
import { useConversation } from "./use-conversation";
import { useVoice } from "./use-voice";
import { VoicePanel } from "./voice-panel";
import { errorText } from "./errors";
import { CatalogPanel, groupedChannels } from "./catalog-panel";
import { ModerationPanel, isStaff } from "./moderation-panel";
import { MessageHistory } from "./message-history";
import { AdmissionPanel } from "./admission-panel";
import brandIcon from "./assets/yapper-icon.jpg";
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
function Brand() {
  return (
    <a href="/" className="wordmark">
      <img src={brandIcon} alt="" width={30} height={30} />
      Yapper
    </a>
  );
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
          <Brand />
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
        <Brand />
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
        onAdmissionChange={(openAdmission) =>
          setState((current) => current && { ...current, openAdmission })
        }
        onSignOut={async () => {
          await logout();
          setUser(null);
        }}
      />
    );
  return (
    <div className="entry-shell">
      <header className="entry-header">
        <Brand />
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
      {state.configured && <p className="eyebrow">{state.name}</p>}
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

type ConversationPanel = "admission" | "catalog" | "moderation";

function Conversation({
  user: initialUser,
  state,
  locale,
  language,
  onSignOut,
  onAdmissionChange,
}: {
  user: CurrentUser;
  state: CommunityState;
  locale: Locale;
  language: React.ReactNode;
  onSignOut: () => Promise<void>;
  onAdmissionChange: (openAdmission: boolean) => void;
}) {
  const t = messages[locale];
  const [user, setUser] = useState(initialUser);
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => () => queryClient.clear(), [queryClient]);
  const textChannels = user.channels.filter((c) => c.kind === "text");
  const [selectedChannel, setChannel] = useState(
    () => textChannels.find((channel) => !channel.archived)?.id ?? "",
  );
  const current =
    textChannels.find((channel) => channel.id === selectedChannel) ??
    textChannels.find((channel) => !channel.archived) ??
    textChannels[0];
  const channel = current?.id ?? "";
  const channelName = current?.name ?? state.name;
  const refreshRevision = useRef(0);
  const refreshCommunity = useCallback(async (signal?: AbortSignal) => {
    const revision = ++refreshRevision.current;
    const next = await api.me(signal);
    if (!signal?.aborted && refreshRevision.current === revision) setUser(next);
  }, []);
  const conversation = useConversation(channel, refreshCommunity);
  const voice = useVoice(user.participant.micMuted, conversation.status === "kicked");
  const [error, setError] = useState<unknown>(null);
  const [panel, setPanel] = useState<ConversationPanel | null>(null);
  const [moderationTarget, setModerationTarget] = useState("");
  const [channelsOpen, setChannelsOpen] = useState(false);
  const channelToggle = useRef<HTMLButtonElement>(null);
  const channelSidebar = useRef<HTMLElement>(null);
  const closeChannels = useCallback(() => {
    setChannelsOpen(false);
    if (channelToggle.current?.getClientRects().length) channelToggle.current.focus();
  }, []);
  useEffect(() => {
    if (!channelsOpen || !channelToggle.current?.getClientRects().length) return;
    const sidebar = channelSidebar.current;
    const channel =
      sidebar?.querySelector<HTMLElement>('[aria-current="page"]') ??
      sidebar?.querySelector<HTMLElement>("nav button");
    channel?.focus();
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) closeChannels();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [channelsOpen, closeChannels]);
  function togglePanel(next: ConversationPanel) {
    closeChannels();
    setModerationTarget("");
    setPanel((visible) => (visible === next ? null : next));
  }
  function closePanel() {
    setPanel(null);
    if (channelToggle.current?.getClientRects().length) {
      channelToggle.current.focus();
    } else {
      document.getElementById("server-tools-toggle")?.focus();
    }
  }
  function moderate(target: string) {
    setModerationTarget(target);
    setPanel("moderation");
  }
  function switchChannel(id: string) {
    closeChannels();
    if (id === channel) return;
    setChannel(id);
    setError(null);
  }
  return (
    <div className="chat-workspace" data-channels-open={channelsOpen}>
      <header className="topbar">
        <Button
          ref={channelToggle}
          className="mobile-channels-toggle"
          variant="ghost"
          size="sm"
          aria-controls="workspace-channels workspace-profile"
          aria-label={`${t.channels}: ${channelName}`}
          aria-expanded={channelsOpen}
          onClick={() => {
            if (channelsOpen) closeChannels();
            else setChannelsOpen(true);
          }}
        >
          <Hash size={18} aria-hidden="true" />
          <span className="mobile-channel-name">{channelName}</span>
          <ChevronDown className="mobile-channel-chevron" size={17} aria-hidden="true" />
        </Button>
        <div className="channel-title">
          <Hash size={18} aria-hidden="true" />
          <strong>{channelName}</strong>
        </div>
        <div className="topbar-tools">
          <ConnectionStatus conversation={conversation} locale={locale} />
          {language}
        </div>
      </header>
      <ConversationSidebar
        sidebarRef={channelSidebar}
        user={user}
        state={state}
        locale={locale}
        channel={channel}
        voice={voice}
        onChannel={switchChannel}
        onClose={closeChannels}
        panel={panel}
        onPanel={togglePanel}
        kicked={conversation.status === "kicked"}
      />
      <main className="conversation">
        <QueryClientProvider client={queryClient}>
          <ConversationPanels
            panel={panel}
            user={user}
            openAdmission={state.openAdmission}
            locale={locale}
            onAdmissionChange={onAdmissionChange}
            onCatalogChange={refreshCommunity}
            onClose={closePanel}
            moderationTarget={moderationTarget}
            memberRevision={conversation.memberRevision}
          />
        </QueryClientProvider>
        <MessageHistory
          key={channel}
          items={conversation.messages}
          hasOlder={conversation.hasOlder}
          loadingOlder={conversation.loadingOlder}
          onLoadOlder={conversation.loadOlder}
          onChanged={conversation.refresh}
          archived={current?.archived ?? false}
          locked={conversation.status === "kicked"}
          user={user}
          locale={locale}
          onModerate={moderate}
        />
        <div className="composer-area">
          {(error ?? conversation.error) !== null && (
            <p role="alert" className="error-message">
              {errorText(error ?? conversation.error, locale)}
            </p>
          )}
          {current?.archived && <p className="composer-hint">{t.archivedNotice}</p>}
          {current && !current.archived && (
            <MessageComposer
              key={channel}
              channel={channel}
              name={current.name}
              locale={locale}
              onSent={conversation.refresh}
              disabled={conversation.status === "kicked"}
            />
          )}
        </div>
      </main>
      <VoicePanel
        voice={voice}
        channels={user.channels.filter((item) => item.kind === "voice")}
        forcedMuted={user.participant.micMuted}
        locale={locale}
        kicked={conversation.status === "kicked"}
      />
      <WorkspaceProfile
        user={user}
        locale={locale}
        language={language}
        onSignOut={onSignOut}
        onError={setError}
      />
    </div>
  );
}
function ConnectionStatus({
  conversation,
  locale,
}: {
  conversation: ReturnType<typeof useConversation>;
  locale: Locale;
}) {
  const t = messages[locale];
  return (
    <div className="connection-bar" data-state={conversation.status}>
      <span
        className={conversation.status === "connected" ? "status-dot" : "status-dot status-warning"}
      />
      <output>{t[conversation.status]}</output>
      {conversation.status === "kicked" && (
        <Button size="sm" variant="outline" onClick={conversation.reconnect}>
          {t.reconnect}
        </Button>
      )}
    </div>
  );
}

function ConversationPanels({
  panel,
  user,
  locale,
  openAdmission,
  onAdmissionChange,
  onCatalogChange,
  onClose,
  moderationTarget,
  memberRevision,
}: {
  panel: ConversationPanel | null;
  user: CurrentUser;
  locale: Locale;
  openAdmission: boolean;
  onAdmissionChange: (open: boolean) => void;
  onCatalogChange: () => Promise<void>;
  onClose: () => void;
  moderationTarget: string;
  memberRevision: number;
}) {
  if (panel === "moderation" && isStaff(user.participant)) {
    return (
      <ModerationPanel
        key={moderationTarget}
        actor={user.participant}
        target={moderationTarget}
        revision={memberRevision}
        locale={locale}
        onClose={onClose}
      />
    );
  }
  if (user.participant.role !== "owner") return null;
  if (panel === "admission")
    return (
      <AdmissionPanel
        openAdmission={openAdmission}
        locale={locale}
        onAdmissionChange={onAdmissionChange}
        onClose={onClose}
      />
    );
  if (panel === "catalog")
    return (
      <CatalogPanel catalog={user} locale={locale} onChanged={onCatalogChange} onClose={onClose} />
    );
  return null;
}

function MessageComposer({
  channel,
  name,
  locale,
  onSent,
  disabled,
}: {
  channel: string;
  name: string;
  locale: Locale;
  onSent: (channel: string) => void;
  disabled: boolean;
}) {
  const t = messages[locale];
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ requestId: string; body: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (disabled || sending || !draft.trim()) return;
    const input =
      pending && pending.body === draft.trim()
        ? pending
        : { requestId: crypto.randomUUID(), body: draft.trim() };
    setPending(input);
    setSending(true);
    setError(null);
    try {
      await api.send(channel, input);
      onSent(channel);
      setDraft("");
      setPending(null);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
      <form className="composer" onSubmit={(event) => void send(event)}>
        <textarea
          aria-label={t.messagePlaceholder}
          placeholder={`${t.messagePlaceholder} #${name}`}
          value={draft}
          maxLength={2000}
          rows={2}
          disabled={disabled || sending}
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
          disabled={disabled || sending || !draft.trim()}
          aria-label={sending ? t.sending : pending ? t.retrySend : t.send}
        >
          <Send size={19} />
        </Button>
      </form>
    </>
  );
}
function ConversationSidebar({
  sidebarRef,
  user,
  state,
  locale,
  channel,
  voice,
  onChannel,
  onClose,
  panel,
  kicked,
  onPanel,
}: {
  sidebarRef: React.Ref<HTMLElement>;
  user: CurrentUser;
  state: CommunityState;
  locale: Locale;
  channel: string;
  voice: ReturnType<typeof useVoice>;
  onChannel: (id: string) => void;
  onClose: () => void;
  panel: ConversationPanel | null;
  kicked: boolean;
  onPanel: (panel: ConversationPanel) => void;
}) {
  const t = messages[locale];
  const toolsRef = useRef<HTMLDetailsElement>(null);
  const owner = user.participant.role === "owner";
  function openTool(next: ConversationPanel) {
    if (toolsRef.current) toolsRef.current.open = false;
    onPanel(next);
  }
  return (
    <aside id="workspace-channels" ref={sidebarRef} className="sidebar" aria-label={t.channels}>
      <div className="sidebar-header">
        <Brand />
        <strong>{state.name}</strong>
      </div>
      <div className="sidebar-scroll">
        {(["text", "voice"] as const).map((kind) => {
          const label = kind === "text" ? t.textChannels : t.voiceChannels;
          return (
            <Fragment key={kind}>
              <p className="section-label">{label}</p>
              <nav className="channel-list" aria-label={label}>
                {groupedChannels(user, kind).map((group) => (
                  <Fragment key={group.id}>
                    {group.name && <span className="channel-category">{group.name}</span>}
                    {group.channels.map((item) => (
                      <Fragment key={item.id}>
                        <Button
                          variant="ghost"
                          className="channel-button"
                          aria-current={kind === "text" && item.id === channel ? "page" : undefined}
                          aria-pressed={kind === "voice" ? item.id === voice.channel : undefined}
                          onClick={() => {
                            if (kind === "text") onChannel(item.id);
                            else {
                              onClose();
                              void voice.join(item.id);
                            }
                          }}
                          disabled={kind === "voice" && kicked}
                          title={kind === "voice" ? t.joinVoice : undefined}
                        >
                          {kind === "text" ? <Hash size={16} /> : <Volume2 size={16} />}
                          <span className="channel-name">{item.name}</span>
                          {item.archived && <small>{t.archived}</small>}
                        </Button>
                        {kind === "voice" && item.id === voice.channel && (
                          <ul className="channel-people">
                            {voice.participants.map((person) => (
                              <li key={person.identity} data-speaking={person.speaking}>
                                <span className="status-dot" aria-hidden="true" />
                                <span title={person.name}>{person.name}</span>
                                {person.speaking && <span className="sr-only">{t.speaking}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </nav>
            </Fragment>
          );
        })}
      </div>
      {isStaff(user.participant) && (
        <div className="sidebar-bottom">
          <details ref={toolsRef} className="server-tools">
            <summary id="server-tools-toggle">
              <Settings size={16} aria-hidden="true" />
              {t.serverTools}
            </summary>
            <div className="server-tools-options">
              {owner && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={panel === "admission"}
                    onClick={() => openTool("admission")}
                  >
                    {t.admissionSettings}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={panel === "catalog"}
                    onClick={() => openTool("catalog")}
                  >
                    {t.manageChannels}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={panel === "moderation"}
                onClick={() => openTool("moderation")}
              >
                {t.moderation}
              </Button>
            </div>
          </details>
        </div>
      )}
    </aside>
  );
}

function WorkspaceProfile({
  user,
  locale,
  language,
  onSignOut,
  onError,
}: {
  user: CurrentUser;
  locale: Locale;
  language: React.ReactNode;
  onSignOut: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const t = messages[locale];
  return (
    <div id="workspace-profile" className="self-row">
      <span className="person-avatar">{user.participant.nickname.slice(0, 1).toUpperCase()}</span>
      <div>
        <strong>{user.participant.nickname}</strong>
        <small>{t[user.participant.role]}</small>
      </div>
      <span className="mobile-workspace-language">{language}</span>
      {user.account && (
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
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
