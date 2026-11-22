import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import { api } from "./api";
import { errorText } from "./errors";

export function MessageRetention({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void api
      .messageRetention(signal)
      .then((result) => {
        if (!signal.aborted) setDays(result.days);
      })
      .catch((e) => {
        if (!signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (days === null || busy) return;
    setBusy(true);
    setNotice(false);
    setError(null);
    try {
      setDays((await api.setMessageRetention({ days })).days);
      setNotice(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="message-retention" aria-labelledby="retention-title">
      <h3 id="retention-title">{t.messageRetention}</h3>
      <p id="retention-help">{t.retentionHint}</p>
      {days !== null && (
        <form className="panel-actions" onSubmit={(event) => void save(event)}>
          <label>
            {t.retentionDays}
            <Input
              aria-describedby="retention-help"
              type="number"
              min={0}
              max={36500}
              step={1}
              required
              value={Number.isNaN(days) ? "" : days}
              disabled={busy}
              onChange={(e) => setDays(e.target.valueAsNumber)}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            {t.save}
          </Button>
        </form>
      )}
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
      {days === null && error !== null && (
        <Button
          variant="outline"
          onClick={() => {
            setError(null);
            setReload((value) => value + 1);
          }}
        >
          {t.retryLoad}
        </Button>
      )}
      {notice && <output>{t.retentionSaved}</output>}
    </section>
  );
}
