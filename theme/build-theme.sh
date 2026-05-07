#!/usr/bin/env bash
# Build a Cursor-style desktop look:
#  - Wallpaper: dark gradient mesh (4 blurred blobs) for ambient depth
#  - xfwm4 theme: macOS-style titlebar (full tile set + traffic-light dots)
#  - GTK theme: Arc-Dark
#  - Icons: Papirus-Dark
#  - Cursor: Bibata-Modern-Ice (configured later in xsettings)

set -euo pipefail

WALL_DIR=/usr/share/backgrounds/cursor-style
mkdir -p "${WALL_DIR}"

# Dark gradient mesh: 3 large blurred blobs over a near-black base.
# Same idea as the Cursor reference wallpaper, but in our dark identity.
convert -size 1920x1080 xc:'#0a0a0c' \
    -fill '#1a1422' -draw 'circle 480,300 720,540' \
    -fill '#0d1822' -draw 'circle 1440,800 1620,1020' \
    -fill '#181018' -draw 'circle 960,500 1100,640' \
    -blur 0x180 \
    "${WALL_DIR}/cursor-dark.png"

THEME_DIR=/usr/share/themes/CursorStyle
mkdir -p "${THEME_DIR}/xfwm4"

cat > "${THEME_DIR}/xfwm4/themerc" <<'EOF'
# CursorStyle xfwm4 theme — macOS-style dark titlebar
button_layout=CHM|T
button_offset=8
button_spacing=4
title_alignment=center
title_horizontal_offset=0
title_vertical_offset_active=4
title_vertical_offset_inactive=4
full_width_title=true
maximized_offset=0
shadow_delta_height=0
shadow_delta_width=0
shadow_delta_x=0
shadow_delta_y=0
active_text_color=#e6e6ea
inactive_text_color=#888892
title_shadow_active=false
title_shadow_inactive=false
show_app_icon=false
EOF

cat > "${THEME_DIR}/index.theme" <<'EOF'
[Desktop Entry]
Type=X-GNOME-Metatheme
Name=CursorStyle
Comment=Minimal dark window decorations matching the Cursor cloud-agent UI
Encoding=UTF-8

[X-GNOME-Metatheme]
GtkTheme=Arc-Dark
MetacityTheme=Arc-Dark
IconTheme=Papirus-Dark
CursorTheme=Bibata-Modern-Ice
ButtonLayout=close,minimize,maximize:
EOF

# --- xfwm4 frame tiles --------------------------------------------------------
# xfwm4 stretches these PNGs to draw the window frame. We need:
#   title-{1..5}-{active,inactive}.png       horizontal title strip (1px wide)
#   top-{left,right}-{active,inactive}.png   top corners (8x8)
#   left-{active,inactive}.png               left side (1px wide)
#   right-{active,inactive}.png              right side (1px wide)
#   bottom-{left,right,side}-{active,inactive}.png   bottom edge

TITLE_BG_ACTIVE="#1c1c20"
TITLE_BG_INACTIVE="#161618"
SIDE_COLOR="#0e0e10"
HEIGHT_TITLE=28
HEIGHT_BOTTOM=1
WIDTH_SIDE=1
CORNER=8

# Title strip (1px wide, stretched horizontally by xfwm4)
for state in active inactive; do
    if [ "$state" = active ]; then color="$TITLE_BG_ACTIVE"; else color="$TITLE_BG_INACTIVE"; fi
    for i in 1 2 3 4 5; do
        convert -size 1x${HEIGHT_TITLE} "xc:${color}" \
            "${THEME_DIR}/xfwm4/title-${i}-${state}.png"
    done
done

# Top-left and top-right corners (rounded a tiny bit)
for state in active inactive; do
    if [ "$state" = active ]; then color="$TITLE_BG_ACTIVE"; else color="$TITLE_BG_INACTIVE"; fi
    # Top-left corner: filled rectangle with rounded corner cut out
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

# --- Traffic-light buttons ---------------------------------------------------
# Three macOS-style dots (close=red, minimize=amber, maximize=green)
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

make_button "close"    "#ff5f57" "#3a3a40"
make_button "hide"     "#febc2e" "#3a3a40"
make_button "maximize" "#28c840" "#3a3a40"

cat > /usr/share/glib-2.0/schemas/99_cursor-style.gschema.override <<'EOF'
[org.gnome.desktop.interface]
font-name='Inter 10'
document-font-name='Inter 10'
EOF
glib-compile-schemas /usr/share/glib-2.0/schemas/ 2>/dev/null || true

echo ">>> CursorStyle theme built"
