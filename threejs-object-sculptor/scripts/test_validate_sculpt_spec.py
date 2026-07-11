#!/usr/bin/env python3
"""Focused tests for visual-pass promotion in validate_sculpt_spec."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from validate_sculpt_spec import (  # noqa: E402
    authored_contract_review_binding_sha256,
    authored_contract_review_failures,
    review_completes_pass,
    validate_review_history,
)


def authored_fixture() -> tuple[dict, dict]:
    spec = {
        "referenceSourceKind": "authored-procedural-brief",
        "sourceImage": None,
        "selfCorrectLoop": {
            "visualAcceptance": {
                "comparisonArtifactRequired": False,
                "layerScoresRequired": True,
                "requiredLayerScores": ["silhouetteProportion"],
                "featureReviewPolicy": {
                    "enabled": True,
                    "criticalDefaultThreshold": 0.8,
                    "importantAverageThreshold": 0.65,
                    "maxCriticalFeaturesPerPass": 5,
                    "maxImportantFeaturesPerPass": 3,
                },
            },
        },
        "viewEvidence": [{"id": "brief-silhouette"}],
        "featureReviewTargets": [{
            "id": "authored-silhouette",
            "name": "Authored silhouette",
            "tier": "critical",
            "mustPass": True,
            "minimumScore": 0.8,
            "passIds": ["blockout"],
            "evidenceRefs": ["brief-silhouette"],
        }],
    }
    entry = {
        "passId": "blockout",
        "action": "continue",
        "aiVisionScore": 0.91,
        "visualAcceptanceThreshold": 0.8,
        "layerScores": {"silhouetteProportion": 0.9},
        "featureReviews": [{
            "id": "authored-silhouette",
            "score": 0.92,
            "visible": True,
            "notes": "The authored profile is readable.",
        }],
        "visualEvidence": {
            "referenceScreenshot": "",
            "renderScreenshot": "evidence/lamp.blockout.png",
            "renderScreenshotSha256": "1" * 64,
            "comparisonImage": "",
            "cameraView": "design",
            "authoredContractReview": {
                "reviewId": "lamp-blockout-authored-review",
                "reviewBasis": "authored-contract",
                "status": "pass",
                "artifactPath": "evidence/lamp.blockout.review.json",
                "artifactSha256": "2" * 64,
                "requiredReviewIds": ["authored-silhouette"],
                "requiredEvidenceIds": ["brief-silhouette"],
                "bindingSha256": "0" * 64,
            },
        },
    }
    entry["visualEvidence"]["authoredContractReview"]["bindingSha256"] = (
        authored_contract_review_binding_sha256(spec, entry, "blockout")
    )
    return spec, entry


class AuthoredContractPromotionTests(unittest.TestCase):
    def test_digest_bound_authored_review_completes_visual_pass(self) -> None:
        spec, entry = authored_fixture()
        self.assertEqual(authored_contract_review_failures(spec, entry, "blockout"), [])
        self.assertTrue(review_completes_pass(spec, entry, "blockout"))

    def test_omitted_authored_review_cannot_complete_pass(self) -> None:
        spec, entry = authored_fixture()
        del entry["visualEvidence"]["authoredContractReview"]
        failures = authored_contract_review_failures(spec, entry, "blockout")
        self.assertIn("authored-contract review artifact is missing", failures)
        self.assertFalse(review_completes_pass(spec, entry, "blockout"))

    def test_binding_digest_drift_cannot_complete_pass(self) -> None:
        spec, entry = authored_fixture()
        entry["visualEvidence"]["authoredContractReview"]["bindingSha256"] = "f" * 64
        failures = authored_contract_review_failures(spec, entry, "blockout")
        self.assertTrue(any("bindingSha256 drifted" in failure for failure in failures))
        self.assertFalse(review_completes_pass(spec, entry, "blockout"))

    def test_render_cannot_masquerade_as_comparison_or_review_artifact(self) -> None:
        spec, entry = authored_fixture()
        render_path = entry["visualEvidence"]["renderScreenshot"]
        entry["visualEvidence"]["comparisonImage"] = render_path
        entry["visualEvidence"]["authoredContractReview"]["artifactPath"] = render_path
        entry["visualEvidence"]["authoredContractReview"]["bindingSha256"] = (
            authored_contract_review_binding_sha256(spec, entry, "blockout")
        )
        failures = authored_contract_review_failures(spec, entry, "blockout")
        self.assertIn("render screenshot must not masquerade as a comparison image", failures)
        self.assertIn(
            "render screenshot must not masquerade as the authored-contract review artifact",
            failures,
        )
        self.assertFalse(review_completes_pass(spec, entry, "blockout"))

    def test_reference_mode_still_requires_distinct_comparison_artifact(self) -> None:
        spec, entry = authored_fixture()
        spec["referenceSourceKind"] = "reference-image"
        spec["sourceImage"] = "reference.png"
        spec["selfCorrectLoop"]["visualAcceptance"]["comparisonArtifactRequired"] = True
        self.assertFalse(review_completes_pass(spec, entry, "blockout"))

        entry = copy.deepcopy(entry)
        del entry["visualEvidence"]["authoredContractReview"]
        entry["visualEvidence"]["referenceScreenshot"] = "reference.png"
        entry["visualEvidence"]["comparisonImage"] = "comparison.png"
        self.assertTrue(review_completes_pass(spec, entry, "blockout"))

        entry["visualEvidence"]["comparisonImage"] = entry["visualEvidence"]["renderScreenshot"]
        self.assertFalse(review_completes_pass(spec, entry, "blockout"))

    def test_history_reports_authored_gate_failure_as_strict_quality_warning(self) -> None:
        spec, entry = authored_fixture()
        del entry["visualEvidence"]["authoredContractReview"]
        spec["reviewHistory"] = [entry]
        errors: list[str] = []
        warnings: list[str] = []
        validate_review_history(spec, errors, warnings)
        self.assertEqual(errors, [])
        self.assertTrue(any("authored-contract gate failed" in warning for warning in warnings))


if __name__ == "__main__":
    unittest.main()
