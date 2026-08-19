"""approval.respond must resolve live sid AND durable session-key aliases.

Remote desktop clients send stored_session_id / continuation ids. A miss
used to 4001 or return {resolved: 0}, which cleared the UI while the agent
stayed blocked until timeout (#89111).
"""

from __future__ import annotations

import threading
import types

import pytest

from tui_gateway import server
from tools import approval as approval_mod


def _session(**extra):
    return {
        "agent": types.SimpleNamespace(session_id=extra.get("session_key", "session-key")),
        "session_key": "session-key",
        "history": [],
        "history_lock": threading.Lock(),
        "history_version": 0,
        "running": False,
        "attached_images": [],
        "image_counter": 0,
        "cols": 80,
        **extra,
    }


def _enqueue(session_key: str, command: str = "touch SOUL.md"):
    entry = approval_mod._ApprovalEntry({"command": command})
    with approval_mod._lock:
        approval_mod._gateway_queues.setdefault(session_key, []).append(entry)
    return entry


@pytest.fixture(autouse=True)
def _clean_sessions_and_queues():
    approval_mod._gateway_queues.clear()
    yield
    for sid in list(server._sessions):
        server._sessions.pop(sid, None)
    approval_mod._gateway_queues.clear()


def test_approval_respond_accepts_live_sid():
    stored = "20260101_000000_abc123"
    server._sessions["live1"] = _session(session_key=stored)
    server._sessions["live1"]["agent"].session_id = stored
    entry = _enqueue(stored)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": "live1", "choice": "once"},
        }
    )

    assert resp.get("result", {}).get("resolved") == 1
    assert entry.event.is_set()
    assert entry.result == "once"


def test_approval_respond_accepts_durable_session_key():
    stored = "20260101_000000_def456"
    server._sessions["live2"] = _session(session_key=stored)
    server._sessions["live2"]["agent"].session_id = stored
    entry = _enqueue(stored)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": stored, "choice": "session"},
        }
    )

    assert resp.get("result", {}).get("resolved") == 1, resp
    assert entry.event.is_set()
    assert entry.result == "session"


def test_approval_respond_resolves_queue_under_pre_compress_alias():
    old_key = "parent-session"
    new_key = "continuation-session"
    session = _session(session_key=new_key)
    session["agent"].session_id = new_key
    session["session_key_aliases"] = [old_key, new_key]
    server._sessions["live3"] = session
    entry = _enqueue(old_key)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": "live3", "choice": "always"},
        }
    )

    assert resp.get("result", {}).get("resolved") == 1, resp
    assert entry.event.is_set()
    assert entry.result == "always"


def test_approval_respond_errors_when_nothing_pending():
    stored = "20260101_000000_empty"
    server._sessions["live4"] = _session(session_key=stored)
    server._sessions["live4"]["agent"].session_id = stored

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": "live4", "choice": "once"},
        }
    )

    assert resp.get("error", {}).get("code") == 4010
    assert "no pending approval" in resp["error"]["message"]


def test_approval_respond_unknown_session_is_4001():
    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": "missing", "choice": "once"},
        }
    )
    assert resp.get("error", {}).get("code") == 4001


def test_approval_respond_accepts_pre_compress_stored_id():
    old_key = "parent-stored"
    new_key = "continuation-stored"
    session = _session(session_key=new_key)
    session["agent"].session_id = new_key
    session["session_key_aliases"] = [old_key, new_key]
    server._sessions["live6"] = session
    entry = _enqueue(old_key)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": old_key, "choice": "once"},
        }
    )

    assert resp.get("result", {}).get("resolved") == 1, resp
    assert entry.event.is_set()


def test_compress_sync_keeps_pre_rotate_approval_waiter():
    old_key = "old-compress-key"
    session = _session(session_key=old_key)
    session["agent"] = types.SimpleNamespace(session_id="new-compress-key")
    server._sessions["sid"] = session
    entry = _enqueue(old_key)

    server._sync_session_key_after_compress("sid", session, restart_slash_worker=False)

    assert session["session_key"] == "new-compress-key"
    assert old_key in session["session_key_aliases"]
    assert not entry.event.is_set()

    resp = server.handle_request(
        {
            "id": "1",
            "method": "approval.respond",
            "params": {"session_id": "sid", "choice": "once"},
        }
    )
    assert resp.get("result", {}).get("resolved") == 1, resp
    assert entry.event.is_set()


def test_interrupt_accepts_durable_session_key_and_releases_approval():
    stored = "20260101_000000_int"
    session = _session(session_key=stored)
    session["agent"] = types.SimpleNamespace(session_id=stored, interrupt=lambda: None)
    server._sessions["live5"] = session
    entry = _enqueue(stored)

    resp = server.handle_request(
        {
            "id": "1",
            "method": "session.interrupt",
            "params": {"session_id": stored},
        }
    )

    assert resp.get("result", {}).get("status") == "interrupted", resp
    assert entry.event.is_set()
    assert entry.result == "deny"
