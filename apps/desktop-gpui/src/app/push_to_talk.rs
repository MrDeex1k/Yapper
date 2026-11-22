use super::{Call, CallState, Yapper};
use gpui::{Context, Focusable, KeyDownEvent, KeyUpEvent, Modifiers, Window};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum MicrophoneMode {
    Manual,
    PushToTalk,
    PushToTalkKeyHeld,
}

impl MicrophoneMode {
    pub(super) fn is_push_to_talk(self) -> bool {
        self != Self::Manual
    }

    pub(super) fn release_key(&mut self) -> bool {
        if *self != Self::PushToTalkKeyHeld {
            return false;
        }
        *self = Self::PushToTalk;
        true
    }
}

impl Call {
    fn can_speak(&self) -> bool {
        self.state == CallState::Connected && self.can_publish
    }
}

impl Yapper {
    pub(super) fn toggle_push_to_talk(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.microphone_mode = if self.microphone_mode.is_push_to_talk() {
            MicrophoneMode::Manual
        } else {
            MicrophoneMode::PushToTalk
        };
        if let Some(call) = &self.call {
            call.microphone_intent.send_replace(false);
        }
        window.focus(&self.workspace_focus);
        cx.notify();
    }

    pub(super) fn toggle_microphone(&mut self, cx: &mut Context<Self>) {
        if self.microphone_mode == MicrophoneMode::Manual
            && let Some(call) = self.call.as_ref().filter(|call| call.can_speak())
        {
            call.microphone_intent
                .send_modify(|wanted| *wanted = !*wanted);
            cx.notify();
        }
    }

    pub(super) fn key_down(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = &event.keystroke;
        if key.key != "space" || !self.microphone_mode.is_push_to_talk() {
            return;
        }
        if self.microphone_mode == MicrophoneMode::PushToTalkKeyHeld {
            cx.stop_propagation();
            window.prevent_default();
            return;
        }
        if event.is_held
            || key.modifiers != Modifiers::default()
            || !window.is_window_active()
            || self
                .message_input
                .read(cx)
                .focus_handle(cx)
                .is_focused(window)
        {
            return;
        }
        if let Some(call) = self.call.as_ref().filter(|call| call.can_speak()) {
            self.microphone_mode = MicrophoneMode::PushToTalkKeyHeld;
            call.microphone_intent.send_replace(true);
            cx.stop_propagation();
            window.prevent_default();
        }
    }

    pub(super) fn key_up(
        &mut self,
        event: &KeyUpEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.keystroke.key == "space"
            && self.microphone_mode == MicrophoneMode::PushToTalkKeyHeld
        {
            self.release_push_to_talk(cx);
            cx.stop_propagation();
            window.prevent_default();
        }
    }

    pub(super) fn release_push_to_talk(&mut self, cx: &mut Context<Self>) {
        if self.microphone_mode.release_key() {
            if let Some(call) = &self.call {
                call.microphone_intent.send_replace(false);
            }
            cx.notify();
        }
    }
}
