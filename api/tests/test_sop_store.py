import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_build_sop_relpath_accepts_normal_case(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(tmp_path))

    import app.sop_store as sop_store

    rel = sop_store.build_sop_relpath(
        tenant_id="t1",
        run_id="r1",
        agent_id="a1",
        version=1,
    )
    assert rel == "t1/r1/a1/v1.md"


def test_resolve_rejects_traversal(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(tmp_path))

    import app.sop_store as sop_store

    try:
        _ = sop_store.resolve_sop_abspath("../escape.md")
        assert False, "expected traversal to be rejected"
    except ValueError:
        pass


def test_write_and_read_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ROBOARD_SOP_ROOT", str(tmp_path))

    import app.sop_store as sop_store

    rel = sop_store.build_sop_relpath("t1", "r1", "a1", 2)
    text = "# SOP\nStep 1: Do thing\n"
    sop_store.write_sop_text(rel, text)
    assert sop_store.read_sop_text(rel) == text
