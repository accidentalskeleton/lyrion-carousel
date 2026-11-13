"""Ephemeral opt-in visual demo sessions, kept separate from LMS playback.

No persistent configuration, no browser cookies, no power/playlist operations.
All shared operations use unpredictable session/controller tokens.
"""
from __future__ import annotations
import secrets
import threading
import time

MAX_AGE = 30 * 60

class DemoSessions:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions = {}

    def _prune(self):
        now = time.monotonic()
        for key, value in list(self._sessions.items()):
            if value["until"] < now:
                del self._sessions[key]

    def create(self):
        with self._lock:
            self._prune()
            code = secrets.token_hex(4).upper()
            while code in self._sessions:
                code = secrets.token_hex(4).upper()
            controller = secrets.token_urlsafe(32)
            viewer = secrets.token_urlsafe(32)
            self._sessions[code] = dict(controller=controller, viewer=viewer,
                                        seq=0, step=None, source=None, album_id=None, active=True,
                                        until=time.monotonic()+MAX_AGE)
            return dict(code=code, controller=controller, viewer=viewer)

    def join(self, code):
        with self._lock:
            self._prune()
            session = self._sessions.get(code)
            if not session or not session["active"]:
                return None
            session["until"] = time.monotonic()+MAX_AGE
            return dict(viewer=session["viewer"])

    def state(self, code, viewer):
        with self._lock:
            self._prune()
            session = self._sessions.get(code)
            if not session or not session["active"] or not secrets.compare_digest(session["viewer"], viewer):
                return None
            return {key: session[key] for key in ("seq", "step", "source", "album_id", "active")}

    def update(self, code, controller, action, step=None, source=None, album_id=None):
        with self._lock:
            self._prune()
            session = self._sessions.get(code)
            if not session or not secrets.compare_digest(session["controller"], controller):
                return None
            if action == "stop":
                session["active"] = False
                session["seq"] += 1
            elif (action == "step" and session["active"] and type(step) is int and 0 <= step < 8
                  and source in ("library", "spotify") and isinstance(album_id, str)
                  and 0 < len(album_id) <= 128):
                session["seq"] += 1
                session["step"] = step
                session["source"] = source
                session["album_id"] = album_id
                session["until"] = time.monotonic()+MAX_AGE
            else:
                return None
            return {key: session[key] for key in ("seq", "step", "active")}

DEMO_SESSIONS = DemoSessions()
