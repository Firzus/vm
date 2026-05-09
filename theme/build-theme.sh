#!/usr/bin/env bash
# Editorial Swiss desktop look:
#  - Wallpaper: pre-generated paper composition (COPY'd in Dockerfile)
#  - xfwm4 theme: ivory titlebars + vermilion-trio traffic lights
#  - GTK theme: Arc (light)
#  - Icons: Papirus (light)
#  - Cursor: Bibata-Modern-Classic
#  - Plank theme: EditorialSwiss (paper card + vermilion active indicator)

set -euo pipefail

WALL_DIR=/usr/share/backgrounds/cursor-style
mkdir -p "${WALL_DIR}"
# Wallpaper PNG already lives at ${WALL_DIR}/cursor-paper.png (Dockerfile COPY).

THEME_DIR=/usr/share/themes/EditorialSwiss
mkdir -p "${THEME_DIR}/xfwm4"

cat > "${THEME_DIR}/xfwm4/themerc" <<'EOF'
# EditorialSwiss xfwm4 theme — ivory titlebars, vermilion-trio dots
button_layout=CHM|T
button_offset=10
button_spacing=6
title_alignment=left
title_horizontal_offset=4
title_vertical_offset_active=4
title_vertical_offset_inactive=4
full_width_title=true
maximized_offset=0
shadow_delta_height=0
shadow_delta_width=0
shadow_delta_x=0
shadow_delta_y=0
active_text_color=#0a0a0a
inactive_text_color=#5a544a
title_shadow_active=false
title_shadow_inactive=false
show_app_icon=false
EOF

cat > "${THEME_DIR}/index.theme" <<'EOF'
[Desktop Entry]
Type=X-GNOME-Metatheme
Name=EditorialSwiss
Comment=Ivory paper window decorations matching the VM Console editorial UI
Encoding=UTF-8

[X-GNOME-Metatheme]
GtkTheme=Arc
MetacityTheme=Arc
IconTheme=Papirus
CursorTheme=Bibata-Modern-Classic
ButtonLayout=close,minimize,maximize:
EOF

# --- xfwm4 frame tiles --------------------------------------------------------
# xfwm4 stretches these PNGs to draw the window frame.

TITLE_BG_ACTIVE="#efe8d8"     # ivory (darker than paper #f5f1e8 to read)
TITLE_BG_INACTIVE="#e6dfd0"   # paler ivory
SIDE_COLOR="#d8d2c4"          # rule color
HEIGHT_TITLE=28
HEIGHT_BOTTOM=1
WIDTH_SIDE=1
CORNER=3                      # discrete editorial corner

# Title strip (1px wide, stretched horizontally by xfwm4)
for state in active inactive; do
    if [ "$state" = active ]; then color="$TITLE_BG_ACTIVE"; else color="$TITLE_BG_INACTIVE"; fi
    for i in 1 2 3 4 5; do
        convert -size 1x${HEIGHT_TITLE} "xc:${color}" \
            "${THEME_DIR}/xfwm4/title-${i}-${state}.png"
    done
done

# Top-left and top-right corners (very mildly rounded)
for state in active inactive; do
    if [ "$state" = active ]; then color="$TITLE_BG_ACTIVE"; else color="$TITLE_BG_INACTIVE"; fi
    convert -size ${CORNER}x${HEIGHT_TITLE} xc:none \
        -fill "${color}" \
        -draw "roundrectangle 0,0 $((CORNER * 2)),$((HEIGHT_TITLE - 1)) ${CORNER} ${CORNER}" \
        "${THEME_DIR}/xfwm4/top-left-${state}.png"
    convert -size ${CORNER}x${HEIGHT_TITLE} xc:none \
        -fill "${color}" \
        -draw "roundrectangle -${CORNER},0 $((CORNER - 1)),$((HEIGHT_TITLE - 1)) ${CORNER} ${CORNER}" \
        "${THEME_DIR}/xfwm4/top-right-${state}.png"
done

# Side edges (1px wide, stretched vertically)
for state in active inactive; do
    convert -size ${WIDTH_SIDE}x1 "xc:${SIDE_COLOR}" \
        "${THEME_DIR}/xfwm4/left-${state}.png"
    convert -size ${WIDTH_SIDE}x1 "xc:${SIDE_COLOR}" \
        "${THEME_DIR}/xfwm4/right-${state}.png"
done

# Bottom edge (1px tall, stretched horizontally)
for state in active inactive; do
    convert -size 1x${HEIGHT_BOTTOM} "xc:${SIDE_COLOR}" \
        "${THEME_DIR}/xfwm4/bottom-side-${state}.png"
    convert -size ${CORNER}x${HEIGHT_BOTTOM} "xc:${SIDE_COLOR}" \
        "${THEME_DIR}/xfwm4/bottom-left-${state}.png"
    convert -size ${CORNER}x${HEIGHT_BOTTOM} "xc:${SIDE_COLOR}" \
        "${THEME_DIR}/xfwm4/bottom-right-${state}.png"
done

# --- Traffic-light buttons (vermilion-trio) ----------------------------------
# close = vermilion, hide = ink-soft, maximize = sage neutral.
# Inactive state shares the same paper-soft tone for all three.
make_button () {
    local name="$1" color="$2" inactive_color="$3"
    local size=14
    convert -size ${size}x${size} xc:none \
        -fill "$color" -draw "circle 7,7 7,12" \
        "${THEME_DIR}/xfwm4/${name}-active.png"
    convert -size ${size}x${size} xc:none \
        -fill "$inactive_color" -draw "circle 7,7 7,12" \
        "${THEME_DIR}/xfwm4/${name}-inactive.png"
    cp "${THEME_DIR}/xfwm4/${name}-active.png" "${THEME_DIR}/xfwm4/${name}-prelight.png"
    cp "${THEME_DIR}/xfwm4/${name}-active.png" "${THEME_DIR}/xfwm4/${name}-pressed.png"
}

make_button "close"    "#ff3a17" "#c7c0b2"
make_button "hide"     "#5a544a" "#c7c0b2"
make_button "maximize" "#9ba89a" "#c7c0b2"

# --- GLib schema overrides ----------------------------------------------------
cat > /usr/share/glib-2.0/schemas/99_editorial-swiss.gschema.override <<'EOF'
[org.gnome.desktop.interface]
font-name='Inter Tight 10'
document-font-name='Inter Tight 10'
monospace-font-name='JetBrains Mono 10'
EOF
glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true

# --- Plank dock theme: EditorialSwiss -----------------------------------------
# Plank stores themes under /usr/share/plank/themes/<Name>/{dock.theme,theme}.
PLANK_THEME=/usr/share/plank/themes/EditorialSwiss
mkdir -p "$PLANK_THEME"

cat > "$PLANK_THEME/dock.theme" <<'EOF'
[PlankTheme]
TopRoundness=3
BottomRoundness=3
LineWidth=1
OuterStrokeColor=216;;210;;196;;255
FillStartColor=245;;241;;232;;235
FillEndColor=245;;241;;232;;235
InnerStrokeColor=255;;255;;255;;0

[PlankDockTheme]
HorizPadding=6.0
TopPadding=2.0
BottomPadding=2.0
ItemPadding=4.0
IndicatorSize=2.0
IconShadowSize=0.0
UrgentBounceHeight=1.0
LaunchBounceHeight=0.5
FadeOpacity=0.85
ClickTime=300
UrgentTime=2000
UrgentBlinkCount=2
UrgentColor=255;;58;;23;;255
SelectedItemColor=255;;58;;23;;255
GlowSize=12
ActiveTime=300
EOF

# Plank older versions look for "theme" too. Keep both for safety.
cat > "$PLANK_THEME/theme" <<'EOF'
[PlankTheme]
TopRoundness=3
BottomRoundness=3
LineWidth=1
OuterStrokeColor=216;;210;;196;;255
FillStartColor=245;;241;;232;;235
FillEndColor=245;;241;;232;;235
InnerStrokeColor=255;;255;;255;;0
EOF

echo ">>> EditorialSwiss theme built"
