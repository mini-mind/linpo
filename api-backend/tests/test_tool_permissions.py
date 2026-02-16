import pathlib
import sys


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_tool_permission_deny_blocks_tool(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    from sqlalchemy import create_engine

    import app.main as main

    engine = create_engine("sqlite+pysqlite:///:memory:")
    main.ENGINE = engine
    main.db.SessionLocal.configure(bind=engine)
    main.models.Base.metadata.create_all(engine)

    session = main.db.SessionLocal()
    try:
        tenant = main.models.Tenant()
        setattr(tenant, "name", "t1")
        setattr(tenant, "api_key_hash", "h")
        session.add(tenant)
        session.flush()
        tenant_id = int(getattr(tenant, "id"))

        tool = main.models.Tool()
        setattr(tool, "key", "a2a.send")
        setattr(tool, "enabled", True)
        session.add(tool)
        session.flush()

        perm = main.models.ToolPermission()
        setattr(perm, "tenant_id", tenant_id)
        setattr(perm, "tool_id", int(getattr(tool, "id")))
        setattr(perm, "effect", "deny")
        session.add(perm)
        session.commit()

        import app.tool_permissions as tool_permissions

        try:
            tool_permissions.require_tool_allowed(session, tenant_id, "a2a.send")
            assert False, "expected tool to be denied"
        except ValueError:
            pass
    finally:
        session.close()
