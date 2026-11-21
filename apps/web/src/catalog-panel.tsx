import { useState, type FormEvent } from "react";
import { Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { Channel, CurrentUser } from "@yapper/api";
import { api } from "./api";
import { ChannelEditor } from "./channel-editor";
import { catalogName } from "./channel-form";
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
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const locked = busy || refreshFailed;
  const [nameInvalid, setNameInvalid] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const category = catalog.categories.find((item) => item.id === categoryId);
  const categoryIndex = catalog.categories.findIndex((item) => item.id === categoryId);

  async function change(action: () => Promise<unknown>) {
    if (locked) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await action();
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      await onChanged();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setBusy(false);
    }
  }
  function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = catalogName.safeParse(new FormData(form).get("name"));
    setNameInvalid(!name.success);
    if (!name.success) return;
    void change(async () => {
      await api.saveCategory(categoryId, name.data);
      if (!categoryId) form.reset();
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
              onChange={(e) => {
                setCategoryId(e.target.value);
                setNameInvalid(false);
              }}
              disabled={locked}
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
                aria-invalid={nameInvalid}
                aria-describedby={nameInvalid ? "category-name-error" : undefined}
                onChange={() => setNameInvalid(false)}
                defaultValue={category?.name}
                disabled={locked}
              />
            </label>
            {nameInvalid && (
              <p id="category-name-error" role="alert">
                {t.channelNameError}
              </p>
            )}
            <div className="panel-actions">
              <Button type="submit" disabled={locked}>
                {category ? t.save : t.create}
              </Button>
              {category && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || categoryIndex === 0}
                    onClick={() => void change(() => api.moveCategory(category.id, -1))}
                  >
                    {t.moveUp}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || categoryIndex === catalog.categories.length - 1}
                    onClick={() => void change(() => api.moveCategory(category.id, 1))}
                  >
                    {t.moveDown}
                  </Button>
                </>
              )}
            </div>
          </form>
        </div>
        <ChannelEditor catalog={catalog} locale={locale} busy={locked} change={change} />
      </div>
      {error !== null && (
        <p className="error-message" role="alert">
          {errorText(error, locale)}
        </p>
      )}
      {saved && <output>{t.catalogSaved}</output>}
      {refreshFailed && (
        <div className="panel-actions">
          <p role="alert">{t.catalogRefreshFailed}</p>
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
            {t.retryLoad}
          </Button>
        </div>
      )}
    </section>
  );
}
