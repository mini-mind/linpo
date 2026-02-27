import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_allowed_event_types_include_mvp1_agent_events(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    import app.main as main

    assert "agent.hired" in main.ALLOWED_EVENT_TYPES
    assert "sop.updated" in main.ALLOWED_EVENT_TYPES
    assert "action.applied" in main.ALLOWED_EVENT_TYPES
    assert "run.admission.queued" in main.ALLOWED_EVENT_TYPES
    assert "skill.create.succeeded" in main.ALLOWED_EVENT_TYPES
    assert "skill.create.failed" in main.ALLOWED_EVENT_TYPES
    assert "skill.execute.succeeded" in main.ALLOWED_EVENT_TYPES
    assert "skill.execute.failed" in main.ALLOWED_EVENT_TYPES
    assert "not.a.real.event" not in main.ALLOWED_EVENT_TYPES
