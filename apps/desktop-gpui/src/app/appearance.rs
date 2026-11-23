use gpui::prelude::*;
use gpui::{
    App, AssetSource, Div, Image, ImageFormat, IntoElement, ObjectFit, SharedString, Svg, div, img,
    px, rgb, svg,
};
use gpui_component::{
    Theme, ThemeMode,
    button::{Button, ButtonCustomVariant, ButtonVariants},
};
use std::{
    borrow::Cow,
    sync::{Arc, LazyLock},
};

// Keep these values aligned with the desktop Web palette in apps/web/src/style.css.
pub(super) const TEXT: u32 = 0xf1_f1_f3;
pub(super) const MUTED: u32 = 0xa6_a6_ae;
pub(super) const NAVIGATION: u32 = 0x11_11_13;
pub(super) const BACKGROUND: u32 = 0x1b_1b_1e;
pub(super) const PANEL: u32 = 0x22_22_25;
pub(super) const PRIMARY_HOVER: u32 = 0xde_de_e3;
pub(super) const HOVER: u32 = 0x28_28_2d;
pub(super) const SELECTED: u32 = 0x002d_2d32;
pub(super) const LINE: u32 = 0x34_34_38;
pub(super) const CONTROL_LINE: u32 = 0x5d_5d_65;
pub(super) const ACCENT: u32 = 0xac_89_fc;
pub(super) const DANGER: u32 = 0xff_b4_b9;
pub(super) const DANGER_SURFACE: u32 = 0x48_28_2d;
pub(super) const SIDEBAR_WIDTH: f32 = 254.;
pub(super) const COMPACT_WIDTH: f32 = 700.;

const ASSETS: &[(&str, &[u8])] = &[
    (
        "icons/arrow-right.svg",
        include_bytes!("../../assets/icons/arrow-right.svg"),
    ),
    (
        "icons/check.svg",
        include_bytes!("../../assets/icons/check.svg"),
    ),
    (
        "icons/chevron-down.svg",
        include_bytes!("../../assets/icons/chevron-down.svg"),
    ),
    (
        "icons/hash.svg",
        include_bytes!("../../assets/icons/hash.svg"),
    ),
    (
        "icons/headphones.svg",
        include_bytes!("../../assets/icons/headphones.svg"),
    ),
    (
        "icons/loader.svg",
        include_bytes!("../../assets/icons/loader.svg"),
    ),
    (
        "icons/loader-circle.svg",
        include_bytes!("../../assets/icons/loader-circle.svg"),
    ),
    (
        "icons/mic.svg",
        include_bytes!("../../assets/icons/mic.svg"),
    ),
    (
        "icons/mic-off.svg",
        include_bytes!("../../assets/icons/mic-off.svg"),
    ),
    (
        "icons/panel-left.svg",
        include_bytes!("../../assets/icons/panel-left.svg"),
    ),
    (
        "icons/pencil.svg",
        include_bytes!("../../assets/icons/pencil.svg"),
    ),
    (
        "icons/phone-off.svg",
        include_bytes!("../../assets/icons/phone-off.svg"),
    ),
    (
        "icons/shield.svg",
        include_bytes!("../../assets/icons/shield.svg"),
    ),
    (
        "icons/sliders-horizontal.svg",
        include_bytes!("../../assets/icons/sliders-horizontal.svg"),
    ),
    (
        "icons/trash-2.svg",
        include_bytes!("../../assets/icons/trash-2.svg"),
    ),
    (
        "icons/volume-2.svg",
        include_bytes!("../../assets/icons/volume-2.svg"),
    ),
];

static LOGO: LazyLock<Arc<Image>> = LazyLock::new(|| {
    Arc::new(Image::from_bytes(
        ImageFormat::Jpeg,
        include_bytes!("../../assets/yapper-icon.jpg").to_vec(),
    ))
});

pub(super) struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> gpui::Result<Option<Cow<'static, [u8]>>> {
        Ok(ASSETS
            .iter()
            .find(|(name, _)| *name == path)
            .map(|(_, bytes)| Cow::Borrowed(*bytes)))
    }

    fn list(&self, path: &str) -> gpui::Result<Vec<SharedString>> {
        Ok(ASSETS
            .iter()
            .filter(|(name, _)| name.starts_with(path))
            .map(|(name, _)| (*name).into())
            .collect())
    }
}

pub(super) fn configure(cx: &mut App) {
    Theme::change(ThemeMode::Dark, None, cx);
    let inter_loaded = cx
        .text_system()
        .add_fonts(vec![
            Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Regular.ttf")),
            Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-SemiBold.ttf")),
            Cow::Borrowed(include_bytes!("../../assets/fonts/Inter-Bold.ttf")),
        ])
        .is_ok();
    let theme = Theme::global_mut(cx);
    if inter_loaded {
        theme.font_family = "Inter".into();
    }
    theme.radius = px(7.);
    theme.shadow = false;
    let colors = &mut theme.colors;
    colors.background = rgb(BACKGROUND).into();
    colors.foreground = rgb(TEXT).into();
    colors.border = rgb(LINE).into();
    colors.input = rgb(CONTROL_LINE).into();
    colors.primary = rgb(TEXT).into();
    colors.primary_foreground = rgb(NAVIGATION).into();
    colors.primary_active = rgb(PRIMARY_HOVER).into();
    colors.primary_hover = rgb(PRIMARY_HOVER).into();
    colors.accent = rgb(HOVER).into();
    colors.accent_foreground = rgb(TEXT).into();
    colors.muted = rgb(SELECTED).into();
    colors.muted_foreground = rgb(MUTED).into();
    colors.popover = rgb(PANEL).into();
    colors.popover_foreground = rgb(TEXT).into();
    colors.ring = rgb(ACCENT).into();
    colors.selection = gpui::rgba((ACCENT << 8) | 0x40).into();
}

pub(super) fn icon(name: &'static str, size: f32, color: u32) -> Svg {
    svg()
        .path(name)
        .size(px(size))
        .flex_none()
        .text_color(rgb(color))
}

pub(super) fn brand() -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(9.))
        .font_weight(gpui::FontWeight::BOLD)
        .text_size(px(19.))
        .child(
            img(Arc::clone(&LOGO))
                .size(px(30.))
                .flex_none()
                .rounded(px(8.))
                .object_fit(ObjectFit::Contain),
        )
        .child("Yapper")
}

pub(super) fn status_dot(color: u32) -> Div {
    div().size(px(7.)).flex_none().rounded_full().bg(rgb(color))
}

pub(super) fn outline_button(id: &'static str, cx: &App) -> Button {
    Button::new(id).custom(
        ButtonCustomVariant::new(cx)
            .border(rgb(CONTROL_LINE).into())
            .color(rgb(NAVIGATION).into())
            .hover(rgb(HOVER).into())
            .active(rgb(SELECTED).into()),
    )
}

pub(super) fn voice_button(
    id: &'static str,
    glyph: &'static str,
    label: &'static str,
    foreground: u32,
    style: ButtonCustomVariant,
) -> Button {
    Button::new(id)
        .custom(style)
        .tooltip(label)
        .child(icon(glyph, 17., foreground).into_any_element())
}
