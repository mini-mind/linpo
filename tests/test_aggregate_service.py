from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

from app.db.models import Instance
from app.services.aggregate_service import AggregateService


def _make_instance() -> Instance:
    return Instance(
        id=UUID("11111111-1111-1111-1111-111111111111"),
        user_id=UUID("22222222-2222-2222-2222-222222222222"),
        name="alpha-instance",
        type="openclaw",
        endpoint="ws://example.invalid/openclaw",
        gateway_token_enc="enc",
        status="active",
        last_check_at=datetime(2026, 4, 1, 0, 0, tzinfo=UTC),
        created_at=datetime(2026, 4, 1, 0, 0, tzinfo=UTC),
    )


def test_safe_build_token_group_maps_usage_cost_daily_samples() -> None:
    class FakeProviderApplicationService:
        def usage_cost_summary(self, **kwargs: object) -> dict[str, object]:
            assert kwargs["data_source"] == "openclaw"
            return {
                "totals": {"totalTokens": 75},
                "daily": [
                    {
                        "date": "2026-03-31",
                        "input": 10,
                        "output": 5,
                        "totalTokens": 15,
                    },
                    {
                        "date": "2026-04-01",
                        "input": 40,
                        "output": 20,
                        "totalTokens": 60,
                    },
                ],
            }

    service = AggregateService(provider_application_service=FakeProviderApplicationService())  # type: ignore[arg-type]

    token_group = service._safe_build_token_group(  # type: ignore[attr-defined]
        _make_instance(),
        SimpleNamespace(adapter=object(), cache_key=("cache",)),
    )

    assert token_group.instance_name == "alpha-instance"
    assert token_group.total_tokens == 75
    assert [sample.model_dump() for sample in token_group.samples] == [
        {
            "label": "2026-03-31",
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15,
        },
        {
            "label": "2026-04-01",
            "input_tokens": 40,
            "output_tokens": 20,
            "total_tokens": 60,
        },
    ]


def test_safe_build_token_group_falls_back_to_empty_group_on_usage_error() -> None:
    class FakeProviderApplicationService:
        def usage_cost_summary(self, **kwargs: object) -> dict[str, object]:
            raise RuntimeError("usage unavailable")

    service = AggregateService(provider_application_service=FakeProviderApplicationService())  # type: ignore[arg-type]

    token_group = service._safe_build_token_group(  # type: ignore[attr-defined]
        _make_instance(),
        SimpleNamespace(adapter=object(), cache_key=("cache",)),
    )

    assert token_group.instance_name == "alpha-instance"
    assert token_group.total_tokens is None
    assert token_group.samples == []


def test_safe_build_token_group_accepts_snake_case_and_string_numbers() -> None:
    class FakeProviderApplicationService:
        def usage_cost_summary(self, **kwargs: object) -> dict[str, object]:
            assert kwargs["data_source"] == "openclaw"
            return {
                "totals": {"total_tokens": "96"},
                "samples": [
                    {
                        "label": "2026-03-31",
                        "input_tokens": "24",
                        "output_tokens": 12,
                        "total_tokens": "36",
                    },
                    {
                        "day": "2026-04-01",
                        "input_tokens": "40",
                        "output_tokens": "20",
                    },
                ],
            }

    service = AggregateService(provider_application_service=FakeProviderApplicationService())  # type: ignore[arg-type]

    token_group = service._safe_build_token_group(  # type: ignore[attr-defined]
        _make_instance(),
        SimpleNamespace(adapter=object(), cache_key=("cache",)),
    )

    assert token_group.total_tokens == 96
    assert [sample.model_dump() for sample in token_group.samples] == [
        {
            "label": "2026-03-31",
            "input_tokens": 24,
            "output_tokens": 12,
            "total_tokens": 36,
        },
        {
            "label": "2026-04-01",
            "input_tokens": 40,
            "output_tokens": 20,
            "total_tokens": 60,
        },
    ]
