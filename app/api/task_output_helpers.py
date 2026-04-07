from __future__ import annotations

import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, status

from app.api.schemas import TaskOutputPreviewResponse
from app.db.models import Task
from app.services.task_output_service import (
    parse_task_dependencies as parse_task_dependencies_service,
    task_temp_input_paths as task_temp_input_paths_service,
    task_temp_output_path as task_temp_output_path_service,
)

_OUTPUT_PREVIEW_MAX_BYTES = 120_000
_TASK_OUTPUT_SANDBOX_ROOT = Path('/tmp/linpo').resolve(strict=False)


def parse_task_dependencies(raw: str | None) -> list[str]:
    return parse_task_dependencies_service(raw)


def task_temp_output_path(task: Task) -> str:
    return task_temp_output_path_service(task)


def task_temp_input_paths(task: Task) -> list[str]:
    return task_temp_input_paths_service(task)


def normalize_output_path(raw_path: str) -> Path | None:
    normalized = raw_path.strip()
    if normalized == '' or '\x00' in normalized:
        return None
    candidate = Path(normalized).expanduser()
    if not candidate.is_absolute():
        return None
    try:
        return candidate.resolve(strict=False)
    except OSError:
        return None


def is_task_output_sandbox_path(path: Path) -> bool:
    try:
        path.relative_to(_TASK_OUTPUT_SANDBOX_ROOT)
        return True
    except ValueError:
        return False


def normalize_task_output_sandbox_path(raw_path: str) -> Path | None:
    normalized = normalize_output_path(raw_path)
    if normalized is None:
        return None
    if not is_task_output_sandbox_path(normalized):
        return None
    return normalized


def extract_output_paths_from_artifact(item: str) -> list[str]:
    normalized = item.strip()
    if normalized == '':
        return []

    candidates: list[str] = []
    seen: set[str] = set()

    def add_candidate(value: str) -> None:
        candidate = normalize_task_output_sandbox_path(value.strip())
        if candidate is None:
            return
        normalized = str(candidate)
        if normalized not in seen:
            seen.add(normalized)
            candidates.append(normalized)

    path_pattern = r"(/[^\s\"'<>]+)"
    lowered = normalized.lower()
    if lowered.startswith('artifact:'):
        value = normalized.split(':', 1)[1].strip()
        if value.startswith('/'):
            match = re.match(path_pattern, value)
            if match is not None:
                add_candidate(match.group(1))

    if normalized.startswith('/'):
        match = re.match(path_pattern, normalized)
        if match is not None:
            add_candidate(match.group(1))

    for match in re.findall(r"(/tmp/[^\s\"'<>]+)", normalized):
        add_candidate(match)

    return candidates


def task_output_allowed_paths(task: Task) -> set[Path]:
    extras = task.extras if isinstance(task.extras, dict) else {}
    candidates: list[str] = [task_temp_output_path(task)]
    output_path = str(extras.get('temp_output_path', '')).strip()
    if output_path:
        candidates.append(output_path)
    candidates.extend(task_temp_input_paths(task))
    for item in task.artifacts:
        if not isinstance(item, str):
            continue
        candidates.extend(extract_output_paths_from_artifact(item))

    allowed: set[Path] = set()
    for candidate in candidates:
        normalized = normalize_task_output_sandbox_path(candidate)
        if normalized is not None:
            allowed.add(normalized)
    return allowed


def task_output_candidate_paths(task: Task, requested_path: str | None) -> list[Path]:
    allowed = task_output_allowed_paths(task)
    ordered: list[Path] = []
    seen: set[Path] = set()

    def add_candidate(raw: str | None) -> None:
        if not isinstance(raw, str):
            return
        normalized = normalize_task_output_sandbox_path(raw)
        if normalized is None or normalized not in allowed or normalized in seen:
            return
        seen.add(normalized)
        ordered.append(normalized)

    add_candidate(requested_path)
    extras = task.extras if isinstance(task.extras, dict) else {}
    add_candidate(str(extras.get('temp_output_path', '')).strip())
    add_candidate(task_temp_output_path(task))
    for item in task.artifacts:
        if not isinstance(item, str):
            continue
        for candidate in extract_output_paths_from_artifact(item):
            add_candidate(candidate)
    for input_path in task_temp_input_paths(task):
        add_candidate(input_path)
    return ordered


def pick_existing_task_output_path(task: Task, requested_path: str | None) -> Path | None:
    for candidate in task_output_candidate_paths(task, requested_path):
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def resolve_task_output_path(task: Task, requested_path: str | None) -> Path:
    fallback = task_temp_output_path(task)
    raw_candidate = requested_path if isinstance(requested_path, str) else ''
    candidate = raw_candidate.strip() or fallback
    normalized = normalize_output_path(candidate)
    if normalized is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid output path')

    if normalized not in task_output_allowed_paths(task):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Output path is not allowed for this task')
    return normalized


def guess_output_mime_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or 'application/octet-stream'


def is_binary_content(payload: bytes) -> bool:
    if payload == b'':
        return False
    if b'\x00' in payload:
        return True
    control_count = 0
    for value in payload:
        if value in (9, 10, 13):
            continue
        if value < 32:
            control_count += 1
    return control_count / max(1, len(payload)) > 0.08


def build_output_download_url(*, board_id: str, task_id: UUID, path: Path) -> str:
    encoded_board_id = quote(board_id, safe='')
    encoded_task_id = quote(str(task_id), safe='')
    encoded_path = quote(str(path), safe='')
    return (
        f'/api/v1/boards/{encoded_board_id}/tasks/{encoded_task_id}/output-file'
        f'?path={encoded_path}&download=true'
    )


def build_task_output_preview(*, board_id: str, task: Task, output_path: Path) -> TaskOutputPreviewResponse:
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Output file not found')

    mime_type = guess_output_mime_type(output_path)
    size_bytes = output_path.stat().st_size
    with output_path.open('rb') as handle:
        raw = handle.read(_OUTPUT_PREVIEW_MAX_BYTES + 1)
    truncated = len(raw) > _OUTPUT_PREVIEW_MAX_BYTES
    preview_bytes = raw[:_OUTPUT_PREVIEW_MAX_BYTES]

    kind: str = 'binary'
    content: str | None = None
    if not is_binary_content(preview_bytes):
        decoded = preview_bytes.decode('utf-8', errors='replace')
        if output_path.suffix.lower() == '.json' or mime_type == 'application/json':
            try:
                parsed_json = json.loads(decoded)
                decoded = json.dumps(parsed_json, ensure_ascii=False, indent=2)
                kind = 'json'
            except json.JSONDecodeError:
                kind = 'text'
        else:
            kind = 'text'
        content = decoded

    return TaskOutputPreviewResponse(
        path=str(output_path),
        kind=kind,
        mime_type=mime_type,
        size_bytes=size_bytes,
        truncated=truncated,
        content=content,
        download_url=build_output_download_url(board_id=board_id, task_id=task.id, path=output_path),
    )
