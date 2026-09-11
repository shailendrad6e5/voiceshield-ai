from __future__ import annotations

import math

import pytest

from app.risk import prevention_action, score


@pytest.mark.parametrize(
    ("inputs", "expected_severity"),
    [
        ((0.0, 1.0, 1.0, 0.0), "LOW"),
        ((0.70, 1.0, 1.0, 0.0), "MEDIUM"),
        ((1.0, 0.50, 0.50, 0.0), "HIGH"),
        ((1.0, 0.0, 0.0, 1.0), "CRITICAL"),
    ],
)
def test_risk_score_bounds_and_bands(inputs, expected_severity):
    risk, severity, confidence = score(*inputs)
    assert 0 <= risk <= 100
    assert severity == expected_severity
    assert 0 <= confidence <= 100


def test_non_finite_and_out_of_range_inputs_are_bounded():
    risk, severity, confidence = score(math.nan, math.inf, -math.inf, 5.0)
    assert 0 <= risk <= 100
    assert severity in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert 0 <= confidence <= 100


def test_prevention_actions_follow_the_severity_policy():
    assert prevention_action("LOW") == "CONTINUE MONITORED WORKFLOW"
    assert prevention_action("MEDIUM") == "REQUEST CONTEXTUAL REVIEW"
    assert prevention_action("HIGH") == "REQUIRE STEP-UP VERIFICATION"
    assert prevention_action("CRITICAL") == "REQUIRE STEP-UP VERIFICATION"
