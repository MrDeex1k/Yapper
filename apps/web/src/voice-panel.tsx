import { Headphones, Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { Button } from "@yapper/ui";
import { messages, type Locale } from "@yapper/i18n";
import type { Channel } from "@yapper/api";
import type { AudioDeviceKind } from "./voice-controller";
import type { useVoice } from "./use-voice";

type Voice = ReturnType<typeof useVoice>;

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
  return (
    <>
      {forcedMuted && <output className="voice-moderation-notice">{t.micModerated}</output>}
      {channel && (
        <section className="voice-panel" aria-label={t.voice}>
          <div className="voice-panel-title">
            <Volume2 size={15} aria-hidden="true" />
            <strong>{channel.name}</strong>
            <output>{t[voice.status]}</output>
          </div>
          <VoicePeople voice={voice} locale={locale} />
          <VoiceButtons voice={voice} canSpeak={canSpeak} locale={locale} />
          {voice.status === "connected" && (
            <VoiceSettings voice={voice} canSpeak={canSpeak} locale={locale} />
          )}
          {voice.audioBlocked && (
            <Button variant="outline" size="sm" onClick={() => void voice.startAudio()}>
              {t.startAudio}
            </Button>
          )}
        </section>
      )}
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
  locale,
}: {
  voice: Voice;
  canSpeak: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  return (
    <div className="voice-controls">
      <Button
        size="icon"
        variant="ghost"
        disabled={!canSpeak || voice.pushToTalk}
        aria-label={voice.muted ? t.unmute : t.mute}
        aria-pressed={!voice.muted}
        onClick={voice.toggleMute}
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
        onClick={() => void voice.leave()}
      >
        <PhoneOff size={17} />
      </Button>
    </div>
  );
}

function VoiceSettings({
  voice,
  canSpeak,
  locale,
}: {
  voice: Voice;
  canSpeak: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  return (
    <>
      <label className="voice-push-mode">
        <input
          type="checkbox"
          checked={voice.pushToTalk}
          onChange={(e) => voice.setPushToTalk(e.target.checked)}
        />
        {t.pushToTalk}
      </label>
      {voice.pushToTalk && <TalkButton voice={voice} canSpeak={canSpeak} locale={locale} />}
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

function TalkButton({
  voice,
  canSpeak,
  locale,
}: {
  voice: Voice;
  canSpeak: boolean;
  locale: Locale;
}) {
  const t = messages[locale];
  function release() {
    voice.press(false);
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={voice.muted ? "outline" : "default"}
        disabled={!canSpeak}
        aria-describedby="push-to-talk-hint"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          voice.press(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onBlur={release}
        onKeyDown={(event) => {
          if (!["Space", "Enter"].includes(event.code) || event.repeat) return;
          event.preventDefault();
          voice.press(true);
        }}
        onKeyUp={(event) => {
          if (!["Space", "Enter"].includes(event.code)) return;
          event.preventDefault();
          release();
        }}
      >
        {t.holdToTalk}
      </Button>
      <p id="push-to-talk-hint" className="voice-device-hint">
        {t.pushToTalkHint}
      </p>
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
