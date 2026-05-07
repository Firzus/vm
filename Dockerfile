# syntax=docker/dockerfile:1.6
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8 \
    DISPLAY=:1 \
    HOME=/root \
    USER=root \
    SCREEN_WIDTH=1920 \
    SCREEN_HEIGHT=1080 \
    SCREEN_DEPTH=24 \
    VNC_PORT=5901 \
    NOVNC_PORT=6080 \
    API_PORT=8000 \
    VNC_PASSWORD=agent \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget gnupg software-properties-common \
        sudo locales tzdata xz-utils \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        xfce4 xfce4-goodies xfce4-terminal \
        thunar thunar-archive-plugin \
        plank \
        dbus-x11 \
        xvfb x11vnc \
        novnc websockify \
        xdotool wmctrl scrot imagemagick xclip xdg-utils \
        xfonts-base xfonts-100dpi xfonts-75dpi \
        fonts-noto fonts-noto-color-emoji fonts-liberation fonts-inter \
        arc-theme papirus-icon-theme \
    && rm -rf /var/lib/apt/lists/*

ARG BIBATA_VERSION=2.0.7
RUN set -eux; \
    mkdir -p /usr/share/icons; \
    for variant in Bibata-Modern-Classic Bibata-Modern-Ice; do \
        curl -fsSL -o "/tmp/${variant}.tar.xz" \
            "https://github.com/ful1e5/Bibata_Cursor/releases/download/v${BIBATA_VERSION}/${variant}.tar.xz"; \
        tar -xJf "/tmp/${variant}.tar.xz" -C /usr/share/icons/; \
        rm -f "/tmp/${variant}.tar.xz"; \
        [ -d "/usr/share/icons/${variant}" ]; \
    done; \
    update-alternatives --install /usr/share/icons/default/index.theme x-cursor-theme \
        /usr/share/icons/Bibata-Modern-Ice/index.theme 90 || true

# Google Chrome — pulled from Google's APT repo. Patch the .desktop launcher
# to add --no-sandbox + a per-user data dir so it can run as root inside the VM.
RUN install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
        | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/* \
    && sed -i 's|^Exec=/usr/bin/google-chrome-stable %U$|Exec=/usr/bin/google-chrome-stable --no-sandbox --test-type --user-data-dir=/root/.config/google-chrome --no-first-run --no-default-browser-check --disable-features=PrivacySandboxSettings4 %U|' \
        /usr/share/applications/google-chrome.desktop

# Chrome enterprise policies — kill onboarding, sign-in prompts, sync, ads,
# privacy sandbox dialog, password manager prompts, etc. Lives outside /root
# so it survives volume resets and is authoritative over user settings.
RUN mkdir -p /etc/opt/chrome/policies/managed
COPY chrome/policies/cursor-vm.json /etc/opt/chrome/policies/managed/cursor-vm.json

# Pre-seed the user profile with a First Run marker and minimal Local State so
# Chrome skips its first-run UI even if the volume already has /root cached.
RUN mkdir -p /root/.config/google-chrome \
    && touch /root/.config/google-chrome/First\ Run \
    && printf '%s\n' '{ "browser": { "has_seen_welcome_page": true } }' \
        > /root/.config/google-chrome/Local\ State

COPY theme/build-theme.sh /tmp/build-theme.sh
RUN bash /tmp/build-theme.sh && rm /tmp/build-theme.sh

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv x11-utils \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/automation/.venv \
    PATH=/opt/automation/.venv/bin:$PATH

WORKDIR /opt/automation
RUN python3 -m venv "$VIRTUAL_ENV"
COPY automation/requirements.txt /opt/automation/requirements.txt
RUN pip install --upgrade pip \
    && pip install -r /opt/automation/requirements.txt

COPY automation/ /opt/automation/

RUN mkdir -p /root/.vnc \
    && x11vnc -storepasswd "${VNC_PASSWORD}" /root/.vnc/passwd

RUN mkdir -p /root/Downloads /root/Desktop /root/.config/xfce4 /root/.config/plank/dock1/launchers

COPY theme/xfconf /root/.config/xfce4/xfconf/xfce-perchannel-xml/
COPY theme/plank/dock1/settings /root/.config/plank/dock1/settings
COPY theme/plank/dock1/launchers/ /root/.config/plank/dock1/launchers/

# Stash the desktop config inside the image as well, so the entrypoint can
# restore it onto a fresh /root volume (which is a named docker volume).
RUN mkdir -p /etc/skel-vm \
    && cp -a /root/.config /etc/skel-vm/.config

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 5901 6080 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["/usr/local/bin/entrypoint.sh"]
