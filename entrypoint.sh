#!/usr/bin/env bash
set -euo pipefail

: "${SCREEN_WIDTH:=1920}"

# Restore baked-in desktop config onto a fresh (or stale) /root volume.
# Plank and xfconf are declaratively baked into the image, so we always
# restore them: this guarantees the dock launchers and panel settings match
# what the Dockerfile defines, regardless of the named volume's history.
if [ -d /etc/skel-vm/.config ]; then
    # Seed any missing trees first (no overwrite).
    cp -an /etc/skel-vm/.config/. /root/.config/ 2>/dev/null || true
    # Force-overwrite the declarative bits.
    rm -rf /root/.config/plank
    cp -a /etc/skel-vm/.config/plank /root/.config/ 2>/dev/null || true
    rm -rf /root/.config/xfce4/xfconf
    cp -a /etc/skel-vm/.config/xfce4/xfconf /root/.config/xfce4/ 2>/dev/null || true
fi
: "${SCREEN_HEIGHT:=1080}"
: "${SCREEN_DEPTH:=24}"
: "${DISPLAY:=:1}"
: "${VNC_PORT:=5901}"
: "${NOVNC_PORT:=6080}"
: "${API_PORT:=8000}"
: "${VNC_PASSWORD:=agent}"

export DISPLAY SCREEN_WIDTH SCREEN_HEIGHT SCREEN_DEPTH

mkdir -p /var/log/vm /tmp/.X11-unix /root/.vnc
chmod 1777 /tmp/.X11-unix

if [ ! -s /root/.vnc/passwd ] || [ "${VNC_PASSWORD_RESET:-0}" = "1" ]; then
    x11vnc -storepasswd "${VNC_PASSWORD}" /root/.vnc/passwd >/dev/null
fi

cleanup() {
    echo ">>> shutting down"
    pkill -TERM -P $$ || true
    wait || true
}
trap cleanup TERM INT

rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
echo ">>> starting Xvfb on ${DISPLAY} (${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH})"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" \
     -ac +extension RANDR +extension GLX -nolisten tcp \
     >/var/log/vm/xvfb.log 2>&1 &

for i in $(seq 1 30); do
    if xdpyinfo -display "${DISPLAY}" >/dev/null 2>&1; then break; fi
    sleep 0.2
done

# Replace the default Xvfb "+" cursor with a sensible left-pointer until
# XFCE/Bibata takes over the cursor theme a moment later.
xsetroot -cursor_name left_ptr 2>/dev/null || true

# Make Bibata Ice the per-user default cursor theme (read by Gtk/Qt at startup).
mkdir -p /root/.icons/default
cat > /root/.icons/default/index.theme <<'ICON'
[Icon Theme]
Inherits=Bibata-Modern-Ice
ICON

echo ">>> starting XFCE session"
dbus-launch --exit-with-session startxfce4 >/var/log/vm/xfce.log 2>&1 &

sleep 2

# Plank dock — replaces xfce4-panel for a macOS-style dock.
# Launched detached so it survives if XFCE restarts.
echo ">>> starting Plank dock"
# Plank writes default launchers into ~/.config/plank if it has never been
# initialised — to prevent that, ensure our launchers exist first and let
# `DockItems=` in settings drive the displayed order.
mkdir -p /root/.config/plank/dock1/launchers
nohup dbus-launch plank >/var/log/vm/plank.log 2>&1 &
disown || true

echo ">>> starting x11vnc on :${VNC_PORT}"
x11vnc -display "${DISPLAY}" \
       -rfbport "${VNC_PORT}" \
       -rfbauth /root/.vnc/passwd \
       -forever -shared \
       -noxdamage \
       -cursor most -cursor_drag \
       >/var/log/vm/x11vnc.log 2>&1 &
X11VNC_PID=$!

echo ">>> starting noVNC on :${NOVNC_PORT}"
websockify --web=/usr/share/novnc/ \
           "${NOVNC_PORT}" "localhost:${VNC_PORT}" \
           >/var/log/vm/novnc.log 2>&1 &
NOVNC_PID=$!

echo ">>> starting automation API on :${API_PORT}"
cd /opt/automation
uvicorn server:app --host 0.0.0.0 --port "${API_PORT}" \
        --log-level info >/var/log/vm/api.log 2>&1 &
API_PID=$!

cat <<EOF

==========================================================================
  Cursor-style VM is ready.

  Desktop (web)  : http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=remote&password=${VNC_PASSWORD}
  VNC (native)   : localhost:${VNC_PORT}   (password: ${VNC_PASSWORD})
  Automation API : http://localhost:${API_PORT}/docs

  Logs           : docker exec <name> tail -f /var/log/vm/*.log
==========================================================================
EOF

tail -n 0 -F /var/log/vm/*.log 2>/dev/null &

while true; do
    for pid in "$X11VNC_PID" "$NOVNC_PID" "$API_PID"; do
        if ! kill -0 "$pid" 2>/dev/null; then
            echo ">>> critical service (pid=$pid) exited; shutting down"
            cleanup
            exit 1
        fi
    done
    sleep 5
done
