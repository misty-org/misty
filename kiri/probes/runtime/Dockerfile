FROM rust:1.91-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libsoup-3.0-dev \
    xvfb xauth dbus-x11 gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
 && rm -rf /var/lib/apt/lists/*
