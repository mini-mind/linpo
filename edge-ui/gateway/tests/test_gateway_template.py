import os


def test_gateway_template_envsubst() -> None:
    template_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "default.conf.template",
    )
    with open(template_path, "r", encoding="utf-8") as handle:
        content = handle.read()

    assert "${API_BACKEND_URL}" in content
    assert "proxy_pass ${API_BACKEND_URL}" in content
