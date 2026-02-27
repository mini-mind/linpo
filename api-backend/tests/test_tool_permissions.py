# pyright: reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportMissingParameterType=false, reportUnknownArgumentType=false
import importlib
import pathlib
import sys
from typing import Protocol, cast


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


class SessionLike(Protocol):
    def add(self, obj: object) -> None: ...

    def flush(self) -> None: ...

    def commit(self) -> None: ...

    def close(self) -> None: ...


class SessionFactory(Protocol):
    def __call__(self) -> SessionLike: ...

    def configure(self, **kwargs: object) -> None: ...


class MetaDataLike(Protocol):
    def create_all(self, engine: object) -> None: ...


class BaseLike(Protocol):
    metadata: MetaDataLike


class DbModule(Protocol):
    def create_engine(self, url: str) -> object: ...

    SessionLocal: SessionFactory


class ModelLike(Protocol):
    pass


class ModelsModule(Protocol):
    Base: BaseLike
    Tenant: type[ModelLike]
    Tool: type[ModelLike]
    ToolPermission: type[ModelLike]


class MainModule(Protocol):
    ENGINE: object
    db: DbModule
    models: ModelsModule


class ToolPermissionsModule(Protocol):
    def require_tool_allowed(
        self,
        session: SessionLike,
        tenant_id: int,
        tool_key: str,
        run_id: int | None = None,
        agent_id: int | None = None,
    ) -> None: ...


def test_tool_permission_deny_blocks_tool(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    main = cast(MainModule, cast(object, importlib.import_module("app.main")))

    engine = main.db.create_engine("sqlite+pysqlite:///:memory:")
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
        tenant_id = cast(int, getattr(tenant, "id"))

        tool = main.models.Tool()
        setattr(tool, "key", "browser.run")
        setattr(tool, "enabled", True)
        session.add(tool)
        session.flush()

        perm = main.models.ToolPermission()
        setattr(perm, "tenant_id", tenant_id)
        setattr(perm, "tool_id", cast(int, getattr(tool, "id")))
        setattr(perm, "effect", "deny")
        session.add(perm)
        session.commit()

        tool_permissions = cast(
            ToolPermissionsModule,
            cast(object, importlib.import_module("app.tool_permissions")),
        )

        try:
            tool_permissions.require_tool_allowed(session, tenant_id, "mcp.search")
            assert False, "expected tool to be denied"
        except ValueError:
            pass
    finally:
        session.close()


def test_tool_permission_scoped_deny_blocks_only_matching_scope(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    main = cast(MainModule, cast(object, importlib.import_module("app.main")))

    engine = main.db.create_engine("sqlite+pysqlite:///:memory:")
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
        tenant_id = cast(int, getattr(tenant, "id"))

        tool = main.models.Tool()
        setattr(tool, "key", "browser.run")
        setattr(tool, "enabled", True)
        session.add(tool)
        session.flush()

        perm = main.models.ToolPermission()
        setattr(perm, "tenant_id", tenant_id)
        setattr(perm, "tool_id", cast(int, getattr(tool, "id")))
        setattr(perm, "run_id", 10)
        setattr(perm, "effect", "deny")
        session.add(perm)
        session.commit()

        tool_permissions = cast(
            ToolPermissionsModule,
            cast(object, importlib.import_module("app.tool_permissions")),
        )

        tool_permissions.require_tool_allowed(session, tenant_id, "mcp.search", run_id=11)

        try:
            tool_permissions.require_tool_allowed(session, tenant_id, "mcp.search", run_id=10)
            assert False, "expected scoped tool to be denied"
        except ValueError:
            pass
    finally:
        session.close()


def test_tool_permission_requires_explicit_allow_when_permissions_exist(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_API_KEY", "test-admin")
    monkeypatch.setenv("INTERNAL_API_KEY", "test-internal")

    main = cast(MainModule, cast(object, importlib.import_module("app.main")))

    engine = main.db.create_engine("sqlite+pysqlite:///:memory:")
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
        tenant_id = cast(int, getattr(tenant, "id"))

        tool = main.models.Tool()
        setattr(tool, "key", "browser.run")
        setattr(tool, "enabled", True)
        session.add(tool)
        session.flush()

        perm = main.models.ToolPermission()
        setattr(perm, "tenant_id", tenant_id)
        setattr(perm, "tool_id", cast(int, getattr(tool, "id")))
        setattr(perm, "effect", "allow")
        session.add(perm)
        session.commit()

        tool_permissions = cast(
            ToolPermissionsModule,
            cast(object, importlib.import_module("app.tool_permissions")),
        )

        try:
            tool_permissions.require_tool_allowed(session, tenant_id, "mcp.search")
            assert False, "expected tool to be denied without explicit permission"
        except ValueError:
            pass
    finally:
        session.close()
