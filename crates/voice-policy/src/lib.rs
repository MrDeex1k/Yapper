//! Local microphone publication rules for a Yapper voice session.

#![forbid(unsafe_code)]

/// The user's microphone intent and the conditions in which it can take effect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MicrophoneState {
    pub requested: bool,
    pub connected: bool,
    pub can_publish: bool,
    pub deafened: bool,
}

impl MicrophoneState {
    /// Returns whether the client can publish microphone audio now.
    pub fn allows_publication(self) -> bool {
        self.requested && self.connected && self.can_publish && !self.deafened
    }
}

#[cfg(test)]
mod tests {
    use super::MicrophoneState;

    #[test]
    fn publication_requires_intent_connection_permission_and_listening() {
        let ready = MicrophoneState {
            requested: true,
            connected: true,
            can_publish: true,
            deafened: false,
        };
        assert!(ready.allows_publication());
        for state in [
            MicrophoneState {
                requested: false,
                ..ready
            },
            MicrophoneState {
                connected: false,
                ..ready
            },
            MicrophoneState {
                can_publish: false,
                ..ready
            },
            MicrophoneState {
                deafened: true,
                ..ready
            },
        ] {
            assert!(!state.allows_publication(), "{state:?}");
        }
    }
}

#[cfg(kani)]
mod verification {
    use super::MicrophoneState;

    #[kani::proof]
    fn publication_matches_all_four_conditions() {
        let state = MicrophoneState {
            requested: kani::any(),
            connected: kani::any(),
            can_publish: kani::any(),
            deafened: kani::any(),
        };
        let conditions = (
            state.requested,
            state.connected,
            state.can_publish,
            state.deafened,
        );
        assert_eq!(
            state.allows_publication(),
            matches!(conditions, (true, true, true, false))
        );
    }
}
