import { useState, type FormEvent } from "react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { Channel, CurrentUser } from "@yapper/api";
import { api } from "./api";
import { errorText } from "./errors";

type Catalog = Pick<CurrentUser, "categories" | "channels">;

export function groupedChannels(catalog: Catalog, kind: Channel["kind"]) {
  const channels = catalog.channels.filter(
    (channel) => channel.kind === kind && (kind === "text" || !channel.archived),
  );
  return [{ id: "", name: "" }, ...catalog.categories]
    .map((category) => ({
      ...category,
      channels: channels.filter((channel) => channel.categoryId === category.id),
    }))
    .filter((category) => category.channels.length > 0);
}

export function CatalogPanel({
  catalog,
  locale,
  onChanged,
  onClose,
}: {
  catalog: Catalog;
  locale: Locale;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const t = messages[locale];
  const [categoryId, setCategoryId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const category = catalog.categories.find((item) => item.id === categoryId);
  const channel = catalog.channels.find((item) => item.id === channelId);
  const categoryIndex = catalog.categories.findIndex((item) => item.id === categoryId);
  const siblings = channel
    ? catalog.channels.filter(
        (item) => item.kind === channel.kind && item.categoryId === channel.categoryId,
      )
    : [];
  const channelIndex = siblings.findIndex((item) => item.id === channelId);

  async function change(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await action();
      await onChanged();
      setConfirmArchive(false);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    void change(async () => {
      await api.saveCategory(categoryId, name);
      if (!categoryId) form.reset();
    });
  }
  function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = {
      name: String(data.get("name")).trim(),
      categoryId: String(data.get("categoryId")),
    };
    void change(async () => {
      if (channelId) await api.saveChannel(channelId, input);
      else {
        await api.createChannel({
          ...input,
          kind: data.get("kind") === "voice" ? "voice" : "text",
        });
        form.reset();
      }
    });
  }
  return (
    <section
      className="inline-panel admission-panel catalog-panel"
      id="catalog-panel"
      aria-labelledby="catalog-title"
    >
      <div className="admission-mode">
        <h2 id="catalog-title">{t.manageChannels}</h2>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </div>
      <div className="catalog-forms">
        <div>
          <label>
            {t.category}
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={busy}
            >
              <option value="">{t.newCategory}</option>
              {catalog.categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <form key={categoryId} onSubmit={saveCategory}>
            <label>
              {t.categoryName}
              <Input
                name="name"
                required
                maxLength={64}
                defaultValue={category?.name}
                disabled={busy}
              />
            </label>
            <div className="panel-actions">
              <Button type="submit" disabled={busy}>
                {category ? t.save : t.create}
              </Button>
              {category && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || categoryIndex === 0}
                    onClick={() => void change(() => api.moveCategory(category.id, -1))}
                  >
                    {t.moveUp}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || categoryIndex === catalog.categories.length - 1}
                    onClick={() => void change(() => api.moveCategory(category.id, 1))}
                  >
                    {t.moveDown}
                  </Button>
                </>
              )}
            </div>
          </form>
        </div>
        <div>
          <label>
            {t.channel}
            <select
              value={channelId}
              onChange={(e) => {
                setChannelId(e.target.value);
                setConfirmArchive(false);
              }}
              disabled={busy}
            >
              <option value="">{t.newChannel}</option>
              {catalog.channels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.archived ? ` (${t.archived})` : ""}
                </option>
              ))}
            </select>
          </label>
          <form key={channelId} onSubmit={saveChannel}>
            <label>
              {t.channelName}
              <Input
                name="name"
                required
                maxLength={64}
                defaultValue={channel?.name}
                disabled={busy}
              />
            </label>
            {!channel && (
              <label>
                {t.channelKind}
                <select name="kind" disabled={busy}>
                  <option value="text">{t.textChannels}</option>
                  <option value="voice">{t.voiceChannels}</option>
                </select>
              </label>
            )}
            <label>
              {t.category}
              <select name="categoryId" defaultValue={channel?.categoryId ?? ""} disabled={busy}>
                <option value="">{t.uncategorized}</option>
                {catalog.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-actions">
              <Button type="submit" disabled={busy}>
                {channel ? t.save : t.create}
              </Button>
              {channel && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || channelIndex === 0}
                    onClick={() => void change(() => api.moveChannel(channel.id, -1))}
                  >
                    {t.moveUp}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || channelIndex === siblings.length - 1}
                    onClick={() => void change(() => api.moveChannel(channel.id, 1))}
                  >
                    {t.moveDown}
                  </Button>
                  {!channel.archived && !confirmArchive && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmArchive(true)}
                    >
                      {t.archiveChannel}
                    </Button>
                  )}
                </>
              )}
            </div>
          </form>
          {channel && confirmArchive && (
            <>
              <p role="alert">{t.confirmArchive}</p>
              <div className="panel-actions">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void change(() => api.archiveChannel(channel.id))}
                >
                  {t.archiveChannel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmArchive(false)}
                >
                  {t.cancel}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
      {saved && <output>{t.catalogSaved}</output>}
    </section>
  );
}
