import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@base-ui/react/button";
import { messages, type Locale } from "@yapper/i18n";
import "./style.css";

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem("yapper.locale");
    return saved === "pl" || (saved !== "en" && navigator.language.startsWith("pl")) ? "pl" : "en";
  });
  const [status, setStatus] = useState<"offline" | "connecting" | "ready">("offline");
  const t = messages[locale];
  function changeLocale(value: Locale) {
    setLocale(value);
    localStorage.setItem("yapper.locale", value);
    document.documentElement.lang = value;
  }
  async function checkConnection() {
    setStatus("connecting");
    try {
      const response = await fetch("/api/v1/health", { signal: AbortSignal.timeout(5000) });
      setStatus(response.ok ? "ready" : "offline");
    } catch {
      setStatus("offline");
    }
  }
  return (
    <div className="workspace" lang={locale}>
      <aside className="sidebar" aria-label={t.channels}>
        <a className="wordmark" href="/">
          yapper<span aria-hidden="true">.</span>
        </a>
        <div className="server-name">{t.server}</div>
        <p className="section-label">{t.channels}</p>
        <div className="channel selected">
          <span aria-hidden="true">#</span> {t.general}
        </div>
        <div className="channel muted">
          <span aria-hidden="true">◉</span> {t.lounge}
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" />
          {t.privacy}
        </div>
      </aside>
      <main className="conversation">
        <header className="topbar">
          <span># {t.general}</span>
          <label className="locale-switch">
            {t.language}
            <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)}>
              <option value="en">EN</option>
              <option value="pl">PL</option>
            </select>
          </label>
        </header>
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">YAPPER / {t.build}</p>
          <h1 id="welcome-title">{t.workspace}</h1>
          <p className="description">{t.foundation}</p>
          <Button
            className="primary-action"
            onClick={() => void checkConnection()}
            disabled={status === "connecting"}
          >
            {t.retry}
            <span aria-hidden="true">↗</span>
          </Button>
          <output className="connection-state">
            {t.connection}: {t[status]}
          </output>
        </section>
        <footer className="conversation-footer">Yapper · 0.0.0</footer>
      </main>
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
