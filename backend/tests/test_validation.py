
import pytest

from aic_gate.validation import AccessRequest, validate_request


def valid_request(**overrides):
    values = {
        "bucket": "cloudsec.proj.aicgate",
        "prefix": "logs/",
        "actions": ["s3:GetObject"],
        "duration_minutes": 15,
        "reason": "Investigate application errors",
    }
    values.update(overrides)
    return AccessRequest(**values)


def test_valid_request_is_accepted():
    validate_request(valid_request())


@pytest.mark.parametrize("duration", [0, 14, 61, -1, True])
def test_invalid_duration_is_rejected(duration):
    with pytest.raises(ValueError):
        validate_request(valid_request(duration_minutes=duration))


def test_unapproved_bucket_is_rejected():
    with pytest.raises(ValueError, match="allowlisted"):
        validate_request(valid_request(bucket="another-bucket"))


@pytest.mark.parametrize(
    "prefix",
    ["", "/logs/", "../secrets/", "logs/../secrets/", "logs\\secrets/"],
)
def test_invalid_prefix_is_rejected(prefix):
    with pytest.raises(ValueError):
        validate_request(valid_request(prefix=prefix))


@pytest.mark.parametrize(
    "actions",
    [
        [],
        ["s3:DeleteObject"],
        ["*"],
        ["s3:GetObject", "s3:GetObject"],
    ],
)
def test_disallowed_actions_are_rejected(actions):
    with pytest.raises(ValueError):
        validate_request(valid_request(actions=actions))


def test_missing_reason_is_rejected():
    with pytest.raises(ValueError, match="reason"):
        validate_request(valid_request(reason="  "))
