import { useRef, useState, useSyncExternalStore } from "react";
import {
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Button, Dialog, IconButton, TooltipProvider } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { Channel } from "@yapper/api";
import type { AudioDeviceKind } from "./voice-controller";
import type { useVoice } from "./use-voice";

type Voice = ReturnType<typeof useVoice>;

const compactViewport = "(max-width: 700px)";

function subscribeToCompactLayout(notify: () => void) {
  const query = window.matchMedia(compactViewport);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

function isCompactLayout() {
  return window.matchMedia(compactViewport).matches;
}

export function VoicePanel({
  voice,
  channels,
  forcedMuted,
  kicked,
  locale,
}: {
  voice: Voice;
  channels: Channel[];
  forcedMuted: boolean;
  kicked: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  const channel = channels.find((item) => item.id === voice.channel);
  const retry = channels.find((item) => item.id === voice.retryChannel && !item.archived);
  const canSpeak =
    voice.status === "connected" && voice.canPublish && !forcedMuted && !voice.deafened;
  if (!channel && !forcedMuted && !voice.error && (!retry || kicked)) return null;
  return (
    <section className="voice-dock" aria-label={t.voice}>
      {channel && (
        <VoiceSession
          key={channel.id}
          channel={channel}
          voice={voice}
          canSpeak={canSpeak}
          locale={locale}
        />
      )}
      {forcedMuted && <output className="voice-moderation-notice">{t.micModerated}</output>}
      {voice.error && (
        <p role="alert" className="error-message">
          {t[voice.error]}
        </p>
      )}
      {retry && !kicked && (
        <Button variant="outline" size="sm" onClick={() => void voice.join(retry.id)}>
          {t.retryVoice}
        </Button>
      )}
    </section>
  );
}

function VoiceSession({
  channel,
  voice,
  canSpeak,
  locale,
}: {
  channel: Channel;
  voice: Voice;
  canSpeak: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  const [detailsOpen, setDetailsOpen] = useState(false);
  const compact = useSyncExternalStore(subscribeToCompactLayout, isCompactLayout);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  function updateDetails(open: boolean) {
    setDetailsOpen(open);
    if (open && voice.status === "connected") void voice.refreshDevices();
  }

  const details = (
    <>
      <VoicePeople voice={voice} locale={locale} />
      {voice.status === "connected" && <VoiceSettings voice={voice} locale={locale} />}
    </>
  );
  return (
    <>
      <div className="voice-dock-row">
        <div className="voice-panel-title">
          <Volume2 size={18} aria-hidden="true" />
          <div>
            <strong>{channel.name}</strong>
            <output>
              {voice.status === "connected" ? (
                <>
                  <span className="voice-connected-label">{t.connected} · </span>
                  {voice.muted
                    ? voice.pushToTalk && canSpeak
                      ? t.pushToTalkKeyboard
                      : t.micMutedStatus
                    : t.micOnStatus}
                </>
              ) : (
                t[voice.status]
              )}
            </output>
          </div>
        </div>
        <div className="voice-controls">
          <TooltipProvider delay={260}>
            <VoiceButtons voice={voice} canSpeak={canSpeak} compact={compact} locale={locale} />
            <IconButton
              ref={detailsTrigger}
              variant="ghost"
              label={t.voiceDetails}
              aria-controls={!compact || detailsOpen ? "voice-details" : undefined}
              aria-expanded={detailsOpen}
              aria-haspopup={compact ? "dialog" : undefined}
              onClick={() => updateDetails(!detailsOpen)}
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
            </IconButton>
          </TooltipProvider>
        </div>
      </div>
      {compact ? (
        <Dialog.Root open={detailsOpen} onOpenChange={updateDetails}>
          <Dialog.Portal>
            <Dialog.Backdrop className="voice-sheet-backdrop" />
            <Dialog.Popup id="voice-details" className="voice-sheet" finalFocus={detailsTrigger}>
              <header className="voice-sheet-heading">
                <Dialog.Title>{t.voiceDetails}</Dialog.Title>
                <Dialog.Close render={<Button variant="ghost" size="icon" />} aria-label={t.close}>
                  <X size={18} aria-hidden="true" />
                </Dialog.Close>
              </header>
              <DeafenButton voice={voice} locale={locale} labelled />
              {details}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <div id="voice-details" className="voice-details" hidden={!detailsOpen}>
          {details}
        </div>
      )}
      {voice.audioBlocked && (
        <Button variant="outline" size="sm" onClick={() => void voice.startAudio()}>
          {t.startAudio}
        </Button>
      )}
    </>
  );
}

function VoicePeople({ voice, locale }: { voice: Voice; locale: Locale }) {
  const t = messages[locale];
  return voice.participants.map((person) => (
    <div
      key={person.identity}
      className={person.speaking ? "voice-person voice-speaking" : "voice-person"}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="voice-person-name">{person.name}</span>
      {person.speaking && <span className="sr-only">{t.speaking}</span>}
      {!person.local && (
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(person.volume * 100)}
          onChange={(e) => voice.setVolume(person.identity, e.target.valueAsNumber / 100)}
          aria-label={`${t.participantVolume}: ${person.name}`}
        />
      )}
    </div>
  ));
}

function VoiceButtons({
  voice,
  canSpeak,
  compact,
  locale,
}: {
  voice: Voice;
  canSpeak: boolean;
  compact: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  return (
    <>
      {!voice.pushToTalk && (
        <IconButton
          variant={voice.muted ? "default" : "ghost"}
          disabled={!canSpeak}
          label={voice.muted ? t.unmute : t.mute}
          aria-pressed={!voice.muted}
          onClick={voice.toggleMute}
        >
          {voice.muted ? <MicOff size={17} /> : <Mic size={17} />}
        </IconButton>
      )}
      {!compact && <DeafenButton voice={voice} locale={locale} />}
      <IconButton
        variant="ghost"
        className="voice-leave"
        label={t.leaveVoice}
        onClick={() => void voice.leave()}
      >
        <PhoneOff size={17} />
      </IconButton>
    </>
  );
}

function DeafenButton({
  voice,
  locale,
  labelled = false,
}: {
  voice: Voice;
  locale: Locale;
  labelled?: boolean;
}) {
  const t = messages[locale];
  const label = voice.deafened ? t.undeafen : t.deafen;
  const icon = voice.deafened ? (
    <VolumeX size={17} aria-hidden="true" />
  ) : (
    <Headphones size={17} aria-hidden="true" />
  );
  return labelled ? (
    <Button variant="outline" size="sm" aria-pressed={voice.deafened} onClick={voice.toggleDeafen}>
      {icon}
      {label}
    </Button>
  ) : (
    <IconButton
      variant="ghost"
      label={label}
      aria-pressed={voice.deafened}
      onClick={voice.toggleDeafen}
    >
      {icon}
    </IconButton>
  );
}

function VoiceSettings({ voice, locale }: { voice: Voice; locale: Locale }) {
  const t = messages[locale];
  return (
    <>
      {voice.canUsePushToTalk && (
        <label className="voice-push-mode">
          <input
            type="checkbox"
            checked={voice.pushToTalk}
            onChange={(e) => voice.setPushToTalk(e.target.checked)}
          />
          <span>
            {t.pushToTalk}
            <small>{t.pushToTalkHint}</small>
          </span>
        </label>
      )}
      <details
        className="voice-device-settings"
        onToggle={(event) => {
          if (event.currentTarget.open) void voice.refreshDevices();
        }}
      >
        <summary>{t.audioDevices}</summary>
        <DeviceSelect kind="audioinput" value={voice.input} voice={voice} locale={locale} />
        {voice.supportsOutput ? (
          <>
            <DeviceSelect kind="audiooutput" value={voice.output} voice={voice} locale={locale} />
            {voice.supportsOutputPicker && (
              <Button variant="outline" size="sm" onClick={() => void voice.pickOutput()}>
                {t.chooseAudioOutput}
              </Button>
            )}
          </>
        ) : (
          <p>{t.audioOutputUnsupported}</p>
        )}
        <Button variant="ghost" size="sm" onClick={() => void voice.refreshDevices()}>
          {t.refreshAudioDevices}
        </Button>
      </details>
    </>
  );
}

function DeviceSelect({
  kind,
  value,
  voice,
  locale,
}: {
  kind: AudioDeviceKind;
  value: string;
  voice: Voice;
  locale: Locale;
}) {
  const t = messages[locale];
  const devices = voice.devices.filter((device) => device.kind === kind);
  return (
    <label>
      {kind === "audioinput" ? t.audioInput : t.audioOutput}
      <select value={value} onChange={(event) => void voice.setDevice(kind, event.target.value)}>
        <option value="default">{t.systemAudioDefault}</option>
        {value !== "default" && !devices.some((device) => device.deviceId === value) && (
          <option value={value}>{t.audioDeviceUnavailable}</option>
        )}
        {devices.map((item, index) => (
          <option key={item.deviceId} value={item.deviceId}>
            {item.label || `${t.audioDevice} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
