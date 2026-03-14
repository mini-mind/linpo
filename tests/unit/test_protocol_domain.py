def test_protocol_info_stores_minimal_protocol_metadata() -> None:
    from app.domain.protocol import ProtocolInfo

    info = ProtocolInfo(
        version="1.0.0",
        endpoints={"callback_base": "https://linpo.duckdns.org/callback"},
        auth={"type": "token", "header": "X-Claw-Token"},
        task_types=["echo"],
    )

    assert info.version == "1.0.0"
    assert info.endpoints == {"callback_base": "https://linpo.duckdns.org/callback"}
    assert info.auth == {"type": "token", "header": "X-Claw-Token"}
    assert info.task_types == ["echo"]


def test_protocol_info_copies_mutable_inputs() -> None:
    from app.domain.protocol import ProtocolInfo

    endpoints = {"callback_base": "https://linpo.duckdns.org/callback"}
    auth = {"type": "token", "header": "X-Claw-Token"}
    task_types = ["echo"]

    info = ProtocolInfo(
        version="1.0.0",
        endpoints=endpoints,
        auth=auth,
        task_types=task_types,
    )

    endpoints["callback_base"] = "https://changed.example/callback"
    auth["type"] = "none"
    task_types.append("relay")

    assert info.endpoints == {"callback_base": "https://linpo.duckdns.org/callback"}
    assert info.auth == {"type": "token", "header": "X-Claw-Token"}
    assert info.task_types == ["echo"]
