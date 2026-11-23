
from datetime import timedelta
from unittest.mock import patch

import pytest

from aic_gate.service import read_session_object, submit_access_request
from aic_gate.validation import AccessRequest


@pytest.fixture(autouse=True)
def fake_session_store(monkeypatch):
    store = {}

    def fake_save(session):
        store[session.session_id] = session

    def fake_load(session_id):
        return store.get(session_id)

    def fake_update_status(session_id, status):
        if session_id in store:
            store[session_id].status = status

    monkeypatch.setattr("aic_gate.service.save_session", fake_save)
    monkeypatch.setattr("aic_gate.service.load_access_session", fake_load)
    monkeypatch.setattr("aic_gate.service.update_session_status", fake_update_status)
    return store

def test_read_session_object_rejects_wrong_prefix():
    request = AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=15,
        reason="Test prefix enforcement",
    )
    session = submit_access_request(request)

    with pytest.raises(PermissionError, match="outside the authorized prefix"):
        read_session_object(
            session.session_id,
            "restricted/secret.txt",
        )


def test_read_session_object_rejects_unknown_session():
    with pytest.raises(LookupError, match="Session not found"):
        read_session_object("does-not-exist", "logs/sample.log")


def test_read_session_object_rejects_expired_session():
    request = AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=15,
        reason="Test expired session",
    )
    session = submit_access_request(request)
    expired_at = session.expires_at + timedelta(seconds=1)

    with pytest.raises(PermissionError, match="Session is not active"):
        read_session_object(
            session.session_id,
            "logs/sample.log",
            now=expired_at,
        )


def test_read_session_object_allows_authorized_prefix():
    request = AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=15,
        reason="Test authorized read",
    )
    session = submit_access_request(request)

    with patch(
        "aic_gate.service.read_s3_object",
        return_value="Synthetic log content",
    ) as mock_read:
        content = read_session_object(
            session.session_id,
            "logs/sample.log",
        )

    assert content == "Synthetic log content"
    mock_read.assert_called_once_with(
        "cloudsec.proj.aicgate",
        "logs/sample.log",
    )


@pytest.mark.parametrize(
    "key",
    [
        "",
        "/logs/sample.log",
        "logs/../restricted/secret.txt",
        "logs/./sample.log",
        "logs//sample.log",
        r"logs\sample.log",
    ],
)
def test_read_session_object_rejects_invalid_keys(key, monkeypatch):
    from aic_gate import service

    request = AccessRequest(
        bucket="cloudsec.proj.aicgate",
        prefix="logs/",
        actions=["s3:GetObject"],
        duration_minutes=15,
        reason="Testing invalid object keys",
    )
    session = service.submit_access_request(request)

    def fail_if_called(*args, **kwargs):
        pytest.fail("S3 must not be called for an invalid object key")

    monkeypatch.setattr(service, "read_s3_object", fail_if_called)

    with pytest.raises(PermissionError, match="Invalid object key"):
        service.read_session_object(session.session_id, key)
