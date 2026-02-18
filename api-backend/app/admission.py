# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownParameterType=false, reportUnknownMemberType=false

from __future__ import annotations

import os

from sqlalchemy.orm import Session

from . import models


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    raw = raw.strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _read_meminfo_bytes() -> tuple[int | None, int | None]:
    mem_avail = None
    swap_used = None
    try:
        mem_total_kb = None
        mem_free_kb = None
        mem_avail_kb = None
        swap_total_kb = None
        swap_free_kb = None
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) < 2:
                    continue
                key = parts[0].rstrip(":")
                try:
                    value_kb = int(parts[1])
                except ValueError:
                    continue
                if key == "MemTotal":
                    mem_total_kb = value_kb
                elif key == "MemFree":
                    mem_free_kb = value_kb
                elif key == "MemAvailable":
                    mem_avail_kb = value_kb
                elif key == "SwapTotal":
                    swap_total_kb = value_kb
                elif key == "SwapFree":
                    swap_free_kb = value_kb
        if mem_avail_kb is not None:
            mem_avail = mem_avail_kb * 1024
        elif mem_total_kb is not None and mem_free_kb is not None:
            mem_avail = mem_free_kb * 1024
        if swap_total_kb is not None and swap_free_kb is not None:
            swap_used = (swap_total_kb - swap_free_kb) * 1024
    except Exception:
        return None, None
    return mem_avail, swap_used


def should_queue_run(
    session: Session,
    active_statuses: set[str],
) -> tuple[bool, dict[str, object]]:
    should_queue = False
    details: dict[str, object] = {}

    max_active_users = _env_int("MACHINE_MAX_ACTIVE_USERS", 5)
    details["max_active_users"] = max_active_users
    if max_active_users >= 0:
        active_users = (
            session.query(models.Task.tenant_id)
            .filter(models.Task.status.in_(list(active_statuses)))
            .distinct()
            .count()
        )
        details["active_users"] = active_users
        if active_users >= max_active_users:
            should_queue = True

    mem_avail, swap_used = _read_meminfo_bytes()
    details["mem_avail"] = mem_avail
    details["swap_used"] = swap_used
    swap_fuse_default = 4 * 1024 * 1024 * 1024
    mem_fuse_default = 500 * 1024 * 1024
    swap_fuse = _env_int("MACHINE_SWAP_FUSE_BYTES", swap_fuse_default)
    mem_fuse = _env_int("MACHINE_MEM_AVAILABLE_FUSE_BYTES", mem_fuse_default)
    details["swap_fuse"] = swap_fuse
    details["mem_fuse"] = mem_fuse

    if swap_used is not None and swap_used > swap_fuse:
        should_queue = True
    if mem_avail is not None and mem_avail < mem_fuse:
        should_queue = True

    return should_queue, details
