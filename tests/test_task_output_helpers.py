from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
import pytest

from app.api.task_output_helpers import (
    build_task_output_preview,
    extract_output_paths_from_artifact,
    pick_existing_task_output_path,
    resolve_task_output_path,
    task_output_sandbox_roots,
    task_temp_output_path,
)
from app.db.models import Task


def make_task(*, output_path: str | None, artifacts: list[str] | None = None) -> Task:
    now = datetime.now(timezone.utc)
    return Task(
        id=uuid4(),
        user_id=uuid4(),
        instance_id=None,
        title='task',
        summary='',
        status='queued',
        source='flow',
        agent_id='agent-1',
        agent_name='Agent 1',
        artifacts=artifacts or [],
        extras={
            'board_id': 'default',
            'flow_id': 'flow-a',
            'flow_node': 'node-a',
            'temp_output_path': output_path or "",
            'temp_input_paths': 'none',
        },
        created_at=now,
        updated_at=now,
    )


def _sandbox_dir() -> Path:
    root = task_output_sandbox_roots()[0] / 'test-task-output-helpers' / uuid4().hex
    root.mkdir(parents=True, exist_ok=True)
    return root


def test_extract_output_paths_from_artifact_supports_prefixed_and_inline_tmp_paths() -> None:
    root = task_output_sandbox_roots()[0]
    first = str(root / 'flow-a' / 'node-a.json')
    second = str(root / 'flow-a' / 'node-b.json')
    artifact = f'artifact: {first} and fallback {second}'

    assert extract_output_paths_from_artifact(artifact) == [
        first,
        second,
    ]


def test_extract_output_paths_from_artifact_ignores_non_sandbox_absolute_paths() -> None:
    root = task_output_sandbox_roots()[0]
    first = str(root / 'flow-a' / 'node-a.json')
    second = str((root / '..' / root.name / 'flow-a' / 'node-b.json').resolve(strict=False))
    artifact = f'artifact: /etc/passwd and inline {first} and {second}'

    assert extract_output_paths_from_artifact(artifact) == [
        first,
        str(root / 'flow-a' / 'node-b.json'),
    ]


def test_resolve_task_output_path_rejects_disallowed_paths() -> None:
    sandbox_dir = _sandbox_dir()
    allowed_path = sandbox_dir / 'allowed.json'
    task = make_task(output_path=str(allowed_path))

    assert resolve_task_output_path(task, str(allowed_path)) == allowed_path.resolve()

    forbidden_path = sandbox_dir / 'forbidden.json'
    try:
        resolve_task_output_path(task, str(forbidden_path))
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError('expected resolve_task_output_path to reject forbidden path')


def test_resolve_task_output_path_rejects_task_output_outside_sandbox() -> None:
    task = make_task(output_path='/etc/passwd')
    with pytest.raises(HTTPException) as exc_info:
        resolve_task_output_path(task, None)
    assert exc_info.value.status_code == 403


def test_pick_existing_task_output_path_and_preview_round_trip() -> None:
    sandbox_dir = _sandbox_dir()
    output_path = sandbox_dir / 'result.json'
    output_path.write_text('{"ok": true}', encoding='utf-8')
    task = make_task(output_path=str(output_path), artifacts=[f'artifact: {output_path}'])

    assert task_temp_output_path(task) == str(output_path)
    assert pick_existing_task_output_path(task, None) == output_path.resolve()

    preview = build_task_output_preview(board_id='default', task=task, output_path=output_path.resolve())
    assert preview.kind == 'json'
    assert preview.mime_type == 'application/json'
    assert preview.truncated is False
    assert '"ok": true' in (preview.content or '')
    assert preview.download_url.endswith('download=true')


def test_task_temp_output_path_defaults_to_per_agent_workspace_path() -> None:
    task = make_task(output_path=None)
    resolved = Path(task_temp_output_path(task)).expanduser().resolve(strict=False)
    roots = task_output_sandbox_roots()
    assert any(str(resolved).startswith(f"{root}/") for root in roots)
    assert "/agents/agent-1/linpo/flow-a/node-a.json" in str(resolved)
