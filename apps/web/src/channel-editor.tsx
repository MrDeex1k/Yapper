import { useEffect, useRef, useState } from "react";
import { useForm, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertDialog, Button, Input } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { CurrentUser } from "@yapper/api";
import { api } from "./api";
import { channelForm, type ChannelForm } from "./channel-form";

const emptyChannel: ChannelForm = { name: "", kind: "text", categoryId: "" };

export function ChannelEditor({
  catalog,
  locale,
  busy,
  change,
}: {
  catalog: Pick<CurrentUser, "categories" | "channels">;
  locale: Locale;
  busy: boolean;
  change: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const t = messages[locale];
  const [channelId, setChannelId] = useState("");
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const channelPicker = useRef<HTMLSelectElement>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { dirtyFields, errors, isDirty, isSubmitting },
  } = useForm<ChannelForm>({
    defaultValues: emptyChannel,
    resolver: zodResolver(channelForm),
  });
  const locked = busy || isSubmitting;
  const channel = catalog.channels.find((item) => item.id === channelId);
  useEffect(() => {
    if (!isDirty && channel) {
      reset({ name: channel.name, kind: channel.kind, categoryId: channel.categoryId });
    }
  }, [channel, isDirty, reset]);
  const siblings = channel
    ? catalog.channels.filter(
        (item) => item.kind === channel.kind && item.categoryId === channel.categoryId,
      )
    : [];
  const channelIndex = siblings.findIndex((item) => item.id === channelId);

  function selectChannel(id: string) {
    const next = catalog.channels.find((item) => item.id === id);
    setChannelId(next?.id ?? "");
    setPendingChannelId(null);
    setConfirmArchive(false);
    reset(next ? { name: next.name, kind: next.kind, categoryId: next.categoryId } : emptyChannel);
  }

  const saveChannel = handleSubmit(({ kind, ...input }) =>
    change(async () => {
      if (channelId) {
        if (!dirtyFields.name && !dirtyFields.categoryId) return;
        await api.saveChannel(channelId, {
          ...(dirtyFields.name ? { name: input.name } : {}),
          ...(dirtyFields.categoryId ? { categoryId: input.categoryId } : {}),
        });
        reset({ ...input, kind });
      } else {
        await api.createChannel({ ...input, kind });
        reset(emptyChannel);
      }
      setConfirmArchive(false);
    }),
  );

  return (
    <div>
      <label>
        {t.channel}
        <select
          ref={channelPicker}
          value={channelId}
          onChange={(event) => {
            const id = event.target.value;
            if (isDirty) setPendingChannelId(id);
            else selectChannel(id);
          }}
          disabled={locked}
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
      <form id="channel-editor" noValidate onSubmit={(event) => void saveChannel(event)}>
        <ChannelFields
          categories={catalog.categories}
          locale={locale}
          isNew={!channel}
          locked={busy}
          register={register}
          errors={errors}
        />
        <div className="panel-actions">
          <Button type="submit" disabled={locked || Boolean(channel && !isDirty)}>
            {channel ? t.save : t.create}
          </Button>
          {channel && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={locked || channelIndex === 0}
                onClick={() => void change(() => api.moveChannel(channel.id, -1))}
              >
                {t.moveUp}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={locked || channelIndex === siblings.length - 1}
                onClick={() => void change(() => api.moveChannel(channel.id, 1))}
              >
                {t.moveDown}
              </Button>
              {!channel.archived && !confirmArchive && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={locked}
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
              disabled={locked}
              onClick={() =>
                void change(async () => {
                  await api.archiveChannel(channel.id);
                  setConfirmArchive(false);
                })
              }
            >
              {t.archiveChannel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={locked}
              onClick={() => setConfirmArchive(false)}
            >
              {t.cancel}
            </Button>
          </div>
        </>
      )}
      <AlertDialog.Root
        open={pendingChannelId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingChannelId(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="voice-sheet-backdrop" />
          <AlertDialog.Popup className="channel-discard-dialog" finalFocus={channelPicker}>
            <AlertDialog.Title>{t.discardChannelChanges}</AlertDialog.Title>
            <AlertDialog.Description>{t.discardChannelChangesDescription}</AlertDialog.Description>
            <div className="panel-actions">
              <AlertDialog.Close render={<Button variant="outline" />}>
                {t.keepEditingChannel}
              </AlertDialog.Close>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (pendingChannelId !== null) selectChannel(pendingChannelId);
                }}
              >
                {t.discardChannelEdits}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function ChannelFields({
  categories,
  locale,
  isNew,
  locked,
  register,
  errors,
}: {
  categories: CurrentUser["categories"];
  locale: Locale;
  isNew: boolean;
  locked: boolean;
  register: UseFormRegister<ChannelForm>;
  errors: FieldErrors<ChannelForm>;
}) {
  const t = messages[locale];
  return (
    <>
      <div>
        <label>
          {t.channelName}
          <Input
            {...register("name")}
            required
            disabled={locked}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "channel-name-error" : undefined}
          />
        </label>
        {errors.name && (
          <p className="error-message" id="channel-name-error" role="alert">
            {t.channelNameError}
          </p>
        )}
      </div>
      {isNew && (
        <div>
          <label>
            {t.channelKind}
            <select
              {...register("kind")}
              disabled={locked}
              aria-invalid={Boolean(errors.kind)}
              aria-describedby={errors.kind ? "channel-kind-error" : undefined}
            >
              <option value="text">{t.textChannels}</option>
              <option value="voice">{t.voiceChannels}</option>
            </select>
          </label>
          {errors.kind && (
            <p className="error-message" id="channel-kind-error" role="alert">
              {t.errorInvalid}
            </p>
          )}
        </div>
      )}
      <div>
        <label>
          {t.category}
          <select
            {...register("categoryId")}
            disabled={locked}
            aria-invalid={Boolean(errors.categoryId)}
            aria-describedby={errors.categoryId ? "channel-category-error" : undefined}
          >
            <option value="">{t.uncategorized}</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {errors.categoryId && (
          <p className="error-message" id="channel-category-error" role="alert">
            {t.errorInvalid}
          </p>
        )}
      </div>
    </>
  );
}
