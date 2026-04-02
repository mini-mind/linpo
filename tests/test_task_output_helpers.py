from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.api.task_output_helpers import (
    build_task_output_preview,
    extract_output_paths_from_artifact,
    pick_existing_task_output_path,
    resolve_task_output_path,
    task_temp_output_path,
)
from app.db.models import Task


def make_task(*, output_path: str, artifacts: list[str] | None = None) -> Task:
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
            'temp_output_path': output_path,
            'temp_input_paths': 'none',
        },
        created_at=now,
        updated_at=now,
    )


def test_extract_output_paths_from_artifact_supports_prefixed_and_inline_tmp_paths() -> None:
    artifact = 'artifact: /tmp/linpo/flow-a/node-a.json and fallback /tmp/linpo/flow-a/node-b.json'

    assert extract_output_paths_from_artifact(artifact) == [
        '/tmp/linpo/flow-a/node-a.json',
        '/tmp/linpo/flow-a/node-b.json',
    ]


def test_resolve_task_output_path_rejects_disallowed_paths(tmp_path: Path) -> None:
    allowed_path = tmp_path / 'allowed.json'
    task = make_task(output_path=str(allowed_path))

    assert resolve_task_output_path(task, str(allowed_path)) == allowed_path.resolve()

    forbidden_path = tmp_path / 'forbidden.json'
    try:
        resolve_task_output_path(task, str(forbidden_path))
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError('expected resolve_task_output_path to reject forbidden path')


def test_pick_existing_task_output_path_and_preview_round_trip(tmp_path: Path) -> None:
    output_path = tmp_path / 'result.json'
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
