#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Run public-WebKit fixtures against the production native host on macOS 15.4+."""
import functools
import http.server
import json
import os
import pathlib
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid

HERE = pathlib.Path(__file__).resolve().parent
TAURI = HERE.parents[1]
NATIVE = TAURI / "native/macos"
FLAGS = ["xcrun", "clang", "-fobjc-arc", "-fblocks", "-Wno-nullability-completeness",
         "-Wno-unguarded-availability-new", "-Wno-incompatible-pointer-types",
         "-framework", "AppKit", "-framework", "WebKit", "-framework", "NaturalLanguage",
         "-framework", "UserNotifications"]

NOTIFICATIONS = "--notifications" in sys.argv

def signing_identity():
    """The development identity Misty's dev build signs with (cli/tasks/dev-signing.ts)."""
    requested = os.environ.get("MISTY_DEV_SIGNING_IDENTITY")
    if requested:
        return requested
    listing = subprocess.run(["security", "find-identity", "-v", "-p", "codesigning"],
                             check=True, capture_output=True, text=True).stdout
    names = re.findall(r'"((?:Apple Development|Mac Developer): [^"]+)"', listing)
    if len(names) != 1:
        raise SystemExit("--notifications needs one Apple Development identity, or MISTY_DEV_SIGNING_IDENTITY.")
    return names[0]

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, timeout=180)

class QuietServer(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        title = b"POST retained" if body == b"fixture=retained" else b"POST body lost"
        self.wfile.write(b"<!doctype html><title>" + title + b"</title>")

    def log_message(self, *_args):
        pass

with tempfile.TemporaryDirectory(prefix="misty-extension-tests-") as temporary:
    root = pathlib.Path(temporary)
    host = root / "host-probe"
    lifecycle = root / "tab-lifecycle"
    benchmark = root / "benchmark"
    probe = root / "probe"
    messaging = root / "messaging"
    compat = root / "compat-probe"
    executable = root / "native-host"
    production = [NATIVE / "MistyExtensions.m", NATIVE / "MistyExtensionNativeMessaging.m",
                  NATIVE / "MistyExtensionTabs.m", NATIVE / "MistyExtensionCompat.m",
                  NATIVE / "MistyExtensionNotifications.m"]
    run(*FLAGS, HERE / "probe.m", "-o", probe)
    run(*FLAGS, HERE / "host-probe.m", *production, "-o", host)
    run(*FLAGS, HERE / "tab-lifecycle-probe.m", *production[1:], "-o", lifecycle)
    run(*FLAGS, HERE / "host-benchmark.m", *production, "-o", benchmark)
    run(*FLAGS, HERE / "native-messaging-probe.m", production[1], "-o", messaging)
    run(*FLAGS, HERE / "compat-probe.m", *production, "-o", compat)
    if NOTIFICATIONS:
        # UserNotifications serves only registered app bundles outside
        # temporary folders. A stable path, bundle identifier and signing
        # identity keep the permission granted on the first run.
        bundle = TAURI / "target/notification-probe/MistyNotificationProbe.app/Contents"
        shutil.rmtree(bundle.parent, ignore_errors=True)
        (bundle / "MacOS").mkdir(parents=True)
        with (bundle / "Info.plist").open("wb") as output:
            plistlib.dump({"CFBundleIdentifier": "com.misty.test.notification-probe",
                           "CFBundleName": "Misty Notification Probe", "CFBundleExecutable": "notification-probe",
                           "CFBundlePackageType": "APPL", "LSUIElement": True}, output)
        run(*FLAGS, HERE / "notification-probe.m", *production, "-o", bundle / "MacOS/notification-probe")
        run("codesign", "--force", "--sign", signing_identity(), "--timestamp=none", bundle.parent)
    run("xcrun", "clang", HERE / "native-host.c", "-o", executable)
    handler = functools.partial(QuietServer, directory=str(HERE / "fixtures/mv3"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = f"http://127.0.0.1:{server.server_port}/"
    try:
        for version in (2, 3):
            fixture = root / f"mv{version}"
            shutil.copytree(HERE / f"fixtures/mv{version}", fixture)
            run(probe, fixture)
            bridge = fixture / "__misty_sync__"
            bridge.mkdir()
            for name in ("bridge.html", "bridge.js"):
                shutil.copy(TAURI / "src/infra/extensions" / name, bridge / name)
            run(host, fixture, page)
            run(lifecycle, fixture, page)
        # The fixture's manifest and page already reference the layer, as
        # compat::apply writes them; the runner installs the real assets.
        fixture = root / "compat"
        shutil.copytree(HERE / "fixtures/compat", fixture)
        shutil.copytree(TAURI / "src/infra/extensions/compat", fixture / "__misty_compat__")
        run(compat, fixture, page)
        if NOTIFICATIONS:
            output = root / "notification-probe.log"
            print("Notification probe: allow Misty Notification Probe in System Settings > Notifications if asked.")
            run("open", "-W", "-n", "--stdout", output, "--stderr", output, bundle.parent, "--args", fixture)
            log = output.read_text()
            print(log, end="")
            if "PASS:" not in log:
                raise SystemExit("Notification probe failed")
        for count in (0, 1, 3):
            run(benchmark, root / "mv3", count)
        name = "com.misty.test_" + uuid.uuid4().hex
        manifests = pathlib.Path.home() / "Library/Application Support/Mozilla/NativeMessagingHosts"
        manifests.mkdir(parents=True, exist_ok=True)
        manifest = manifests / f"{name}.json"
        try:
            with manifest.open("x") as output:
                json.dump({"name": name, "description": "Temporary Misty test host", "type": "stdio",
                           "path": str(executable), "allowed_extensions": ["native-fixture@misty.test"]}, output)
            run(messaging, name)
        finally:
            manifest.unlink(missing_ok=True)
    finally:
        server.shutdown()
        server.server_close()
