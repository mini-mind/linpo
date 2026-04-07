from __future__ import annotations

import ast
from pathlib import Path


def test_task_dispatch_service_does_not_import_app_api_modules() -> None:
    service_path = Path(__file__).resolve().parent.parent / "app" / "services" / "task_dispatch_service.py"
    source = service_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(service_path))

    forbidden_imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                if module_name == "app.api" or module_name.startswith("app.api."):
                    forbidden_imports.append(module_name)
        elif isinstance(node, ast.ImportFrom):
            module_name = node.module or ""
            if module_name == "app.api" or module_name.startswith("app.api."):
                forbidden_imports.append(module_name)

    assert forbidden_imports == [], (
        "app/services/task_dispatch_service.py must not depend on app.api modules; "
        f"found forbidden imports: {forbidden_imports}"
    )


def test_tasks_api_does_not_define_local_dispatch_orchestration_functions() -> None:
    tasks_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks.py"
    source = tasks_api_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(tasks_api_path))

    forbidden_function_names: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            function_name = node.name
            if function_name.startswith("_dispatch_queue") or function_name == "_dispatch_next_queued_task":
                forbidden_function_names.append(function_name)

    assert forbidden_function_names == [], (
        "app/api/tasks.py must not define local dispatch orchestration helpers "
        "(_dispatch_queue* or _dispatch_next_queued_task); "
        f"found: {forbidden_function_names}"
    )


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


def test_tasks_planner_endpoints_do_not_commit_db_session_directly() -> None:
    tasks_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks.py"
    source = tasks_api_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(tasks_api_path))

    planner_endpoint_names = {
        "stop_flow_planner",
        "planner_upsert_single_node",
        "planner_delete_single_node",
        "planner_complete_session",
        "planner_fail_session",
    }

    violations: dict[str, int] = {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name not in planner_endpoint_names:
            continue

        commit_call_count = 0
        for inner in ast.walk(node):
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

        if commit_call_count > 0:
            violations[node.name] = commit_call_count

    assert violations == {}, (
        "planner endpoints in app/api/tasks.py must not call db_session.commit() directly; "
        f"found: {violations}"
    )


def test_generate_flow_does_not_commit_db_session_directly() -> None:
    tasks_api_path = Path(__file__).resolve().parent.parent / "app" / "api" / "tasks.py"
    source = tasks_api_path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(tasks_api_path))

    generate_flow_node: ast.FunctionDef | ast.AsyncFunctionDef | None = None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "generate_flow":
            generate_flow_node = node
            break

    assert generate_flow_node is not None, "generate_flow must exist in app/api/tasks.py"

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
        "generate_flow in app/api/tasks.py must not call db_session.commit() directly; "
        f"found commit calls: {commit_call_count}"
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
