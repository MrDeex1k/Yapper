use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use unicode_width::UnicodeWidthStr;

#[derive(Default)]
pub(crate) struct Field {
    pub text: String,
    cursor: usize,
}

impl Field {
    pub fn with_text(text: String) -> Self {
        Self {
            cursor: text.len(),
            text,
        }
    }

    pub fn edit(&mut self, key: KeyEvent, limit: usize) {
        match key.code {
            KeyCode::Left => self.cursor = self.previous(),
            KeyCode::Right => self.cursor = self.next(),
            KeyCode::Home => self.cursor = 0,
            KeyCode::End => self.cursor = self.text.len(),
            KeyCode::Backspace => {
                let start = self.previous();
                self.text.replace_range(start..self.cursor, "");
                self.cursor = start;
            }
            KeyCode::Delete => {
                self.text.replace_range(self.cursor..self.next(), "");
            }
            KeyCode::Char('u') if key.modifiers == KeyModifiers::CONTROL => *self = Self::default(),
            KeyCode::Char(ch)
                if !key.modifiers.intersects(
                    KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SUPER,
                ) =>
            {
                let mut bytes = [0; 4];
                self.paste(ch.encode_utf8(&mut bytes), limit);
            }
            _ => {}
        }
    }

    pub fn paste(&mut self, text: &str, limit: usize) {
        let available = limit.saturating_sub(self.text.chars().count());
        let clean: String = text
            .chars()
            .filter(|&ch| visible(ch))
            .take(available)
            .collect();
        self.text.insert_str(self.cursor, &clean);
        self.cursor += clean.len();
    }

    pub fn display(&self, masked: bool) -> (String, u16) {
        let width = if masked {
            self.text[..self.cursor].chars().count()
        } else {
            self.text[..self.cursor].width()
        };
        let text = if masked {
            "•".repeat(self.text.chars().count())
        } else {
            self.text.clone()
        };
        (text, u16::try_from(width).unwrap_or(u16::MAX))
    }

    fn previous(&self) -> usize {
        self.text[..self.cursor]
            .char_indices()
            .next_back()
            .map_or(0, |(index, _)| index)
    }

    fn next(&self) -> usize {
        self.text[self.cursor..]
            .chars()
            .next()
            .map_or(self.cursor, |ch| self.cursor + ch.len_utf8())
    }
}

pub(crate) fn safe_text(text: &str) -> String {
    text.chars().filter(|&ch| visible(ch)).collect()
}

pub(crate) fn safe_message(text: &str) -> String {
    text.chars()
        .filter_map(|ch| match ch {
            '\t' => Some(' '),
            ch if ch == '\n' || visible(ch) => Some(ch),
            _ => None,
        })
        .collect()
}

fn visible(ch: char) -> bool {
    !ch.is_control()
        && !matches!(ch, '\u{061c}' | '\u{200e}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

#[cfg(test)]
mod tests {
    use super::{Field, safe_message, safe_text};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    #[test]
    fn remote_text_cannot_inject_terminal_controls() {
        assert_eq!(safe_text("Ada\u{1b}[1A\n\u{202e}"), "Ada[1A");
        assert_eq!(safe_message("a\t☺\n\r"), "a ☺\n");
    }

    #[test]
    fn editing_preserves_utf8_and_masks_secrets() {
        let mut field = Field::with_text("aąb".into());
        field.edit(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE), 3);
        field.edit(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE), 3);
        field.paste("🙂\n\u{1b}c", 3);
        assert_eq!(field.text, "a🙂b");
        assert_eq!(field.display(true), ("•••".into(), 2));
    }
}
