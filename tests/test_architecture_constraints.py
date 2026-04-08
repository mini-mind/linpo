from __future__ import annotations

import ast
from pathlib import Path

_FORBIDDEN_SESSION_CALLS = {"add", "delete", "execute", "commit", "flush", "rollback", "merge"}


def _all_function_args(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.arg]:
    return [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]


def _is_session_annotation(annotation: ast.expr | None) -> bool:
    if annotation is None:
        return False
    return "Session" in ast.unparse(annotation)


def _is_required_session_annotation(annotation: ast.expr | None) -> bool:
    if annotation is None:
        return False
    text = ast.unparse(annotation)
    return "Session" in text and "Optional" not in text and "None" not in text


def _collect_session_aliases(node: ast.FunctionDef | ast.AsyncFunctionDef) -> set[str]:
    aliases: set[str] = {"db_session"}
    for arg in _all_function_args(node):
        if arg.arg == "db_session" or _is_session_annotation(arg.annotation):
            aliases.add(arg.arg)

    changed = True
    while changed:
        changed = False
        for inner in ast.walk(node):
            value: ast.expr | None = None
            targets: list[ast.expr] = []
            if isinstance(inner, ast.Assign):
                value = inner.value
                targets = inner.targets
            elif isinstance(inner, ast.AnnAssign):
                value = inner.value
                targets = [inner.target]
            if value is None or not isinstance(value, ast.Name) or value.id not in aliases:
                continue
            for target in targets:
                if isinstance(target, ast.Name) and target.id not in aliases:
                    aliases.add(target.id)
                    changed = True
    return aliases


def _collect_session_call_violations(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    violations: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        aliases = _collect_session_aliases(node)
        for inner in ast.walk(node):
            if not isinstance(inner, ast.Call):
                continue
            func = inner.func
            if (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id in aliases
                and func.attr in _FORBIDDEN_SESSION_CALLS
            ):
                violations.append(f"{path.name}:{node.name}:{func.value.id}.{func.attr}")
    return violations


def _get_argument_default(
    node: ast.FunctionDef | ast.AsyncFunctionDef,
    *,
    arg_name: str,
) -> ast.expr | None | object:
    sentinel = object()
    positional_args = [*node.args.posonlyargs, *node.args.args]
    positional_defaults = [sentinel] * (len(positional_args) - len(node.args.defaults)) + list(node.args.defaults)
    for arg, default in zip(positional_args, positional_defaults, strict=True):
        if arg.arg == arg_name:
            return None if default is sentinel else default
    for arg, default in zip(node.args.kwonlyargs, node.args.kw_defaults, strict=True):
        if arg.arg == arg_name:
            return default
    return sentinel


def test_tasks_flow_planner_module_does_not_import_tasks_module() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_flow_planner.py"
    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))

    forbidden_imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                    forbidden_imports.append(module_name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                forbidden_imports.append(module_name)
            if module_name == "app.api":
                for alias in node.names:
                    if alias.name == "tasks":
                        forbidden_imports.append("from app.api import tasks")

    assert forbidden_imports == [], (
        "app/api/tasks_flow_planner.py must not import app.api.tasks; "
        f"found forbidden imports: {forbidden_imports}"
    )


def test_tasks_legacy_module_is_removed() -> None:
    tasks_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks.py"
    assert not tasks_api_path.exists(), "app/api/tasks.py must be removed after router split"


def test_realtime_api_does_not_directly_use_db_session_primitives() -> None:
    realtime_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "realtime.py"
    source = realtime_api_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(realtime_api_path))

    forbidden_names = {"Session", "get_engine", "get_database_url"}
    direct_imports: set[str] = set()
    direct_calls: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            for alias in node.names:
                imported_name = alias.name
                if imported_name in forbidden_names:
                    direct_imports.add(f"from {module_name} import {imported_name}")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imported_module = alias.name
                if imported_module in forbidden_names:
                    direct_imports.add(f"import {imported_module}")
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in forbidden_names:
                direct_calls.add(f"{func.id}()")
            elif isinstance(func, ast.Attribute) and func.attr in forbidden_names:
                direct_calls.add(f"*.{func.attr}()")

    assert direct_imports == set() and direct_calls == set(), (
        "app/api/realtime.py must not directly use db session primitives "
        "(Session/get_engine/get_database_url); "
        f"found imports: {sorted(direct_imports)}, calls: {sorted(direct_calls)}"
    )


def test_generate_flow_does_not_commit_db_session_directly() -> None:
    tasks_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_flow_planner.py"
    source = tasks_api_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(tasks_api_path))

    generate_flow_node: ast.FunctionDef | ast.AsyncFunctionDef | None = None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "generate_flow":
            generate_flow_node = node
            break

    assert generate_flow_node is not None, "generate_flow must exist in app/api/tasks_flow_planner.py"

    commit_call_count = 0
    for inner in ast.walk(generate_flow_node):
        if not isinstance(inner, ast.Call):
            continue
        func = inner.func
        if (
            isinstance(func, ast.Attribute)
            and isinstance(func.value, ast.Name)
            and func.value.id == "db_session"
            and func.attr == "commit"
        ):
            commit_call_count += 1

    assert commit_call_count == 0, (
        "generate_flow in app/api/tasks_flow_planner.py must not call db_session.commit() directly; "
        f"found commit calls: {commit_call_count}"
    )


def test_api_layer_does_not_directly_use_db_session_primitives() -> None:
    api_dir = Path(__file__).resolve().parent.parent / "app" / "api"
    py_files = sorted(path for path in api_dir.glob("*.py") if path.name != "__init__.py")
    violations: list[str] = []

    for path in py_files:
        violations.extend(_collect_session_call_violations(path))

    assert violations == [], (
        "app/api layer must not directly call db_session primitives; "
        f"found: {violations}"
    )


def test_services_layer_does_not_import_api_layer() -> None:
    services_dir = Path(__file__).resolve().parent.parent / "app" / "services"
    py_files = sorted(path for path in services_dir.rglob("*.py") if path.name != "__init__.py")

    violations: dict[str, list[str]] = {}
    for service_file in py_files:
        source = service_file.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(service_file))
        imports: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_name = alias.name
                    if module_name == "app.api" or module_name.startswith("app.api."):
                        imports.append(module_name)
            elif isinstance(node, ast.ImportFrom):
                module_name = node.module or ""
                if module_name == "app.api" or module_name.startswith("app.api."):
                    imports.append(module_name)
        if imports:
            violations[str(service_file)] = sorted(set(imports))

    assert violations == {}, (
        "app/services must not depend on app/api modules; "
        f"found violations: {violations}"
    )




def test_tasks_flow_task_module_does_not_import_tasks_module() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_flow_task.py"
    assert module_path.exists(), "app/api/tasks_flow_task.py must exist"

    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))
    forbidden_imports: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                    forbidden_imports.append(module_name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                forbidden_imports.append(module_name)
            if module_name == "app.api":
                for alias in node.names:
                    if alias.name == "tasks":
                        forbidden_imports.append("from app.api import tasks")

    assert forbidden_imports == [], (
        "app/api/tasks_flow_task.py must not import app.api.tasks; "
        f"found forbidden imports: {forbidden_imports}"
    )


def test_tasks_runtime_module_does_not_duplicate_stale_timeout_logic() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_runtime.py"
    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))

    stale_helper_names = sorted(
        node.name
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_stale_running_seconds"
    )

    assert stale_helper_names == [], (
        "app/api/tasks_runtime.py must not define stale-timeout parsing helpers; "
        "stale-running reconciliation window belongs to app/services/task_dispatch_service.py"
    )


def test_tasks_flow_draft_module_does_not_import_tasks_module() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_flow_draft.py"
    assert module_path.exists(), "app/api/tasks_flow_draft.py must exist"

    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))
    forbidden_imports: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                    forbidden_imports.append(module_name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                forbidden_imports.append(module_name)
            if module_name == "app.api":
                for alias in node.names:
                    if alias.name == "tasks":
                        forbidden_imports.append("from app.api import tasks")

    assert forbidden_imports == [], (
        "app/api/tasks_flow_draft.py must not import app.api.tasks; "
        f"found forbidden imports: {forbidden_imports}"
    )




def test_tasks_runtime_module_does_not_import_tasks_module() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_runtime.py"
    assert module_path.exists(), "app/api/tasks_runtime.py must exist"

    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))
    forbidden_imports: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                    forbidden_imports.append(module_name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if module_name == "app.api.tasks" or module_name.startswith("app.api.tasks."):
                forbidden_imports.append(module_name)
            if module_name == "app.api":
                for alias in node.names:
                    if alias.name == "tasks":
                        forbidden_imports.append("from app.api import tasks")

    assert forbidden_imports == [], (
        "app/api/tasks_runtime.py must not import app.api.tasks; "
        f"found forbidden imports: {forbidden_imports}"
    )


def test_tasks_router_prefix_strategy_is_centralized_in_main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    task_router_modules = {
        "tasks_flow_planner.py": "tasks_flow_planner_router",
        "tasks_flow_task.py": "tasks_flow_task_router",
        "tasks_flow_draft.py": "tasks_flow_draft_router",
        "tasks_runtime.py": "tasks_runtime_router",
    }

    for module_name in task_router_modules:
        module_path = repo_root / "app" / "api" / module_name
        source = module_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(module_path))
        router_prefixes = [
            keyword.value.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "router" for target in node.targets)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Name)
            and node.value.func.id == "APIRouter"
            for keyword in node.value.keywords
            if keyword.arg == "prefix" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str)
        ]
        assert router_prefixes == ["/boards/{board_id}/tasks"], (
            f"app/api/{module_name} router prefix must stay resource-scoped and must not include API version; "
            f"found: {router_prefixes}"
        )

    main_path = repo_root / "app" / "main.py"
    main_source = main_path.read_text(encoding="utf-8")
    main_tree = ast.parse(main_source, filename=str(main_path))
    task_router_names = set(task_router_modules.values())

    prefixed_routers: set[str] = set()
    for node in ast.walk(main_tree):
        if not isinstance(node, ast.Call):
            continue
        if not (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "app"
            and node.func.attr == "include_router"
        ):
            continue
        if len(node.args) != 1 or not isinstance(node.args[0], ast.Name):
            continue
        router_name = node.args[0].id
        if router_name not in task_router_names:
            continue
        has_api_v1_prefix = any(
            keyword.arg == "prefix"
            and isinstance(keyword.value, ast.Name)
            and keyword.value.id == "_API_V1_PREFIX"
            for keyword in node.keywords
        )
        if has_api_v1_prefix:
            prefixed_routers.add(router_name)

    for node in ast.walk(main_tree):
        if not isinstance(node, ast.For):
            continue
        if not isinstance(node.target, ast.Name):
            continue
        if not isinstance(node.iter, (ast.Tuple, ast.List)):
            continue
        loop_router_names = {
            element.id for element in node.iter.elts if isinstance(element, ast.Name) and element.id in task_router_names
        }
        if not loop_router_names:
            continue
        for statement in node.body:
            if not isinstance(statement, ast.Expr) or not isinstance(statement.value, ast.Call):
                continue
            call = statement.value
            if not (
                isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name)
                and call.func.value.id == "app"
                and call.func.attr == "include_router"
            ):
                continue
            if len(call.args) != 1 or not isinstance(call.args[0], ast.Name):
                continue
            if call.args[0].id != node.target.id:
                continue
            has_api_v1_prefix = any(
                keyword.arg == "prefix"
                and isinstance(keyword.value, ast.Name)
                and keyword.value.id == "_API_V1_PREFIX"
                for keyword in call.keywords
            )
            if has_api_v1_prefix:
                prefixed_routers.update(loop_router_names)

    assert prefixed_routers == task_router_names, (
        "app/main.py must inject _API_V1_PREFIX when including all tasks routers; "
        f"missing: {sorted(task_router_names - prefixed_routers)}"
    )


def test_flow_planner_mutation_methods_require_non_optional_db_session() -> None:
    service_path = Path(__file__).resolve().parent.parent / "app" / "services" / "flow_planner_session_service.py"
    source = service_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(service_path))

    target_methods = {
        "create_session",
        "create_or_restore_session",
        "append_message",
        "upsert_node",
        "delete_node",
        "replace_nodes",
        "complete_session",
        "fail_session",
        "stop_session",
    }

    class_node = next(
        (
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "FlowPlannerSessionService"
        ),
        None,
    )
    assert class_node is not None, "FlowPlannerSessionService must exist"

    violations: list[str] = []
    method_names = {
        node.name
        for node in class_node.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    for method_name in sorted(target_methods - method_names):
        violations.append(f"{method_name}:missing")

    for node in class_node.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name not in target_methods:
            continue

        db_arg = next((arg for arg in _all_function_args(node) if arg.arg == "db_session"), None)
        if db_arg is None:
            violations.append(f"{node.name}:db_session_missing")
            continue

        if not _is_required_session_annotation(db_arg.annotation):
            actual = ast.unparse(db_arg.annotation) if db_arg.annotation is not None else "None"
            violations.append(f"{node.name}:db_session_annotation={actual}")

        default = _get_argument_default(node, arg_name="db_session")
        if isinstance(default, ast.Constant) and default.value is None:
            violations.append(f"{node.name}:db_session_default=None")

    assert violations == [], (
        "FlowPlannerSessionService mutation methods must require non-optional db_session "
        "and must not default db_session to None; "
        f"found: {violations}"
    )


def test_task_requirement_id_uses_requirement_id_only() -> None:
    module_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks_common.py"
    source = module_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(module_path))

    target_node = next(
        (
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "task_requirement_id"
        ),
        None,
    )
    assert target_node is not None, "task_requirement_id must exist in app/api/tasks_common.py"

    function_source = ast.get_source_segment(source, target_node)
    assert isinstance(function_source, str) and function_source.strip() != ""
    assert "requirement_id" in function_source, "task_requirement_id must read extras.requirement_id"

    forbidden_fallback_keys = {
        "flow_id",
        "planner_session_key",
        "manager_session_key",
    }
    for key in sorted(forbidden_fallback_keys):
        assert key not in function_source, (
            "task_requirement_id must not include legacy fallback keys; "
            f"found forbidden key: {key}"
        )

    assert "str(task.id)" not in function_source, (
        "task_requirement_id must not fallback to task.id when requirement_id is missing"
    )
