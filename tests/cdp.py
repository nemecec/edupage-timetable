"""Minimal Chrome DevTools Protocol client over a hand-rolled WebSocket.

Only what is needed to load a JavaScript-rendered page and read the resulting
DOM: no third-party dependencies, no browser automation framework. The rest of
the suite runs `page.js` under a stub, which is fast and says nothing about
what a real browser lays out. This is what test_browser.py drives.

Set CHROME_BIN to name the browser. Without one, the tests that need it skip.
"""

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome",
    "chromium",
    "chromium-browser",
]


def find_chrome():
    env = os.environ.get("CHROME_BIN")
    if env:
        return env
    for cand in CHROME_CANDIDATES:
        if os.path.isabs(cand):
            if os.path.exists(cand):
                return cand
        else:
            found = shutil.which(cand)
            if found:
                return found
    raise RuntimeError(
        "No Chrome/Chromium found. Set CHROME_BIN to the browser executable."
    )


class WebSocket:
    """Client-side WebSocket, text frames only."""

    def __init__(self, url):
        assert url.startswith("ws://"), url
        rest = url[len("ws://"):]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)))
        self.sock.settimeout(60)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        while b"\r\n\r\n" not in self.buf:
            self.buf += self._recv()
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError(f"WebSocket handshake failed: {head!r}")

    def _recv(self):
        chunk = self.sock.recv(65536)
        if not chunk:
            raise ConnectionError("WebSocket closed")
        return chunk

    def _need(self, n):
        while len(self.buf) < n:
            self.buf += self._recv()

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        n = len(payload)
        if n < 126:
            header = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 65536:
            header = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            header = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        self.sock.sendall(header + mask + masked)

    def recv(self):
        """Return the next complete text message, reassembling fragments."""
        parts = []
        while True:
            self._need(2)
            b0, b1 = self.buf[0], self.buf[1]
            fin, opcode, masked, n = b0 & 0x80, b0 & 0x0F, b1 & 0x80, b1 & 0x7F
            offset = 2
            if n == 126:
                self._need(4)
                n = struct.unpack("!H", self.buf[2:4])[0]
                offset = 4
            elif n == 127:
                self._need(10)
                n = struct.unpack("!Q", self.buf[2:10])[0]
                offset = 10
            if masked:
                offset += 4
            self._need(offset + n)
            payload = self.buf[offset:offset + n]
            self.buf = self.buf[offset + n:]
            if opcode == 0x8:
                raise ConnectionError("WebSocket closed by peer")
            if opcode == 0x9:  # ping -> pong
                self.sock.sendall(struct.pack("!BB", 0x8A, 0x80 | len(payload))
                                  + b"\x00\x00\x00\x00" + payload)
                continue
            if opcode == 0xA:
                continue
            parts.append(payload)
            if fin:
                return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Browser:
    """Headless Chrome instance, driven over CDP."""

    def __init__(self, port=None, verbose=False):
        self.verbose = verbose
        # A port of its own, so two runs at once do not attach to each other's
        # browser and read the wrong page.
        if port is None:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
        self.profile = tempfile.mkdtemp(prefix="tt-chrome-")
        self.proc = subprocess.Popen(
            [
                find_chrome(),
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--window-size=1600,1200",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={self.profile}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.ws = None
        self.msg_id = 0
        deadline = time.time() + 30
        while True:
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/json/list", timeout=2
                ) as resp:
                    tabs = json.load(resp)
                target = next(t for t in tabs if t.get("type") == "page")
                self.ws = WebSocket(target["webSocketDebuggerUrl"])
                break
            except Exception:
                if time.time() > deadline:
                    raise RuntimeError("Chrome did not expose a debugging port")
                time.sleep(0.2)

    def call(self, method, **params):
        self.msg_id += 1
        mid = self.msg_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expression):
        res = self.call(
            "Runtime.evaluate",
            expression=expression,
            returnByValue=True,
            awaitPromise=True,
        )
        if res.get("exceptionDetails"):
            raise RuntimeError(res["exceptionDetails"].get("text", "JS error"))
        return res["result"].get("value")

    def load(self, url, ready_js, timeout=90, poll=0.5):
        """Navigate and block until ready_js evaluates truthy."""
        self.call("Page.enable")
        self.call("Runtime.enable")
        self.call("Page.navigate", url=url)
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(poll)
            try:
                if self.eval(ready_js):
                    return
            except RuntimeError:
                pass  # navigation in flight; context not ready yet
            if self.verbose:
                print(f"  waiting for page... {int(deadline - time.time())}s left")
        raise TimeoutError(f"Page never satisfied readiness check: {ready_js}")

    def html(self):
        return self.eval("document.documentElement.outerHTML")

    def close(self):
        if self.ws:
            self.ws.close()
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
