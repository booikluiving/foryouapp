"use strict";

const ALGORITHM_CONFIG_SCHEMA_VERSION = "algorithm.config.v0";
const ALGORITHM_SCORE_FEED_SCHEMA_VERSION = "algorithm.score-feed.v0";
const SITUATION_OBSERVED_SCHEMA_VERSION = "algorithm.situation-observed.v0";

function validateAlgorithmScoreFeedShape(feed) {
  const issues = [];
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) {
    return [{ code: "invalid_score_feed", message: "Algorithm score feed must be an object." }];
  }
  if (feed.schemaVersion !== ALGORITHM_SCORE_FEED_SCHEMA_VERSION) {
    issues.push({
      code: "invalid_schema_version",
      message: `Expected schemaVersion ${ALGORITHM_SCORE_FEED_SCHEMA_VERSION}.`,
    });
  }
  if (!feed.showRunId) issues.push({ code: "missing_show_run_id", message: "Score feed requires showRunId." });
  if (!Array.isArray(feed.scores)) {
    issues.push({ code: "missing_scores", message: "Score feed requires scores array." });
  }
  return issues;
}

module.exports = {
  ALGORITHM_CONFIG_SCHEMA_VERSION,
  ALGORITHM_SCORE_FEED_SCHEMA_VERSION,
  SITUATION_OBSERVED_SCHEMA_VERSION,
  validateAlgorithmScoreFeedShape,
};
