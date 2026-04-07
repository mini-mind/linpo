"""Legacy placeholder for historical tasks routes.

All task-related HTTP routes were split into dedicated modules:
- app.api.tasks_flow_planner
- app.api.tasks_flow_task
- app.api.tasks_flow_draft
- app.api.tasks_runtime

This module is intentionally kept empty to preserve import-path stability
for tooling that still references the file path.
"""

__all__: list[str] = []
