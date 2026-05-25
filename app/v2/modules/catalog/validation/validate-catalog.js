"use strict";

const { validateCatalogReadModelShape } = require("../../../shared/contracts/catalog-v0");
const { canAssignCast } = require("../write-model/catalog-store");

function issue(severity, code, entityType, entityId, message, extra = {}) {
  return {
    severity,
    code,
    entityType,
    entityId,
    message,
    ...extra,
  };
}

function ids(items) {
  return new Set((items || []).map((item) => item.id));
}

function activeById(items) {
  const map = new Map();
  for (const item of items || []) map.set(item.id, !!item.active && !item.archivedAt);
  return map;
}

function mediaTypeKey(type) {
  return String(type || "") === "audio" ? "soundscape" : String(type || "");
}

function mediaPresenceKey(asset) {
  return `${asset.environmentId || ""}:${mediaTypeKey(asset.type)}`;
}

function validateCatalogReadModel(readModel) {
  const shapeIssues = validateCatalogReadModelShape(readModel).map((shapeIssue) => issue(
    "error",
    shapeIssue.code,
    "catalog",
    "catalog",
    shapeIssue.message,
    { field: shapeIssue.field || null }
  ));
  if (shapeIssues.length > 0) {
    return {
      ok: false,
      generatedAt: new Date().toISOString(),
      schemaVersion: readModel && readModel.schemaVersion ? readModel.schemaVersion : null,
      counts: {
        errors: shapeIssues.length,
        warnings: 0,
        info: 0,
      },
      issues: shapeIssues,
    };
  }

  const issues = [];
  const performerIds = ids(readModel.performers);
  const characterIds = ids(readModel.characters);
  const environmentIds = ids(readModel.environments);
  const situationIds = ids(readModel.situations);
  const labelIds = ids(readModel.labels);
  const environmentActive = activeById(readModel.environments);
  const activePerformerItems = (readModel.performers || []).filter((item) => item.active && !item.archivedAt);
  const presentMediaKeys = new Set((readModel.mediaAssets || [])
    .filter((asset) => asset.status === "present")
    .map(mediaPresenceKey));

  for (const character of readModel.characters) {
    if (!character.name) {
      issues.push(issue("error", "character_missing_name", "character", character.id, "Character has no name."));
    }
    for (const performerId of character.performerIds || []) {
      if (!performerIds.has(performerId)) {
        issues.push(issue(
          "error",
          "character_missing_performer",
          "character",
          character.id,
          `Character references missing performer ${performerId}.`,
          { relationType: "performer", refId: performerId }
        ));
      }
    }
  }

  for (const environment of readModel.environments) {
    if (!environment.name) {
      issues.push(issue("error", "environment_missing_name", "environment", environment.id, "Environment has no name."));
    }
  }

  for (const label of readModel.labels) {
    if (!label.name) {
      issues.push(issue("error", "label_missing_name", "label", label.id, "Label has no name."));
    }
  }

  for (const situation of readModel.situations) {
    if (!situation.title) {
      issues.push(issue("error", "situation_missing_title", "situation", situation.id, "Situation has no title."));
    }
    for (const characterId of situation.characterIds || []) {
      if (!characterIds.has(characterId)) {
        issues.push(issue(
          "error",
          "situation_missing_character",
          "situation",
          situation.id,
          `Situation references missing character ${characterId}.`,
          { relationType: "character", refId: characterId }
        ));
      }
    }
    const selectedCharacters = (situation.characterIds || [])
      .map((characterId) => (readModel.characters || []).find((item) => item.id === characterId))
      .filter(Boolean);
    const uniqueCharacterIds = new Set(situation.characterIds || []);
    if ((situation.characterIds || []).length < 1 || (situation.characterIds || []).length > 3) {
      issues.push(issue(
        "error",
        "situation_character_count_invalid",
        "situation",
        situation.id,
        "Situation must select 1 to 3 characters.",
        { count: (situation.characterIds || []).length }
      ));
    }
    if (uniqueCharacterIds.size !== (situation.characterIds || []).length) {
      issues.push(issue(
        "error",
        "situation_duplicate_character",
        "situation",
        situation.id,
        "Situation selects the same character more than once."
      ));
    }
    if (
      selectedCharacters.length === (situation.characterIds || []).length
      && selectedCharacters.length > 0
      && !canAssignCast(selectedCharacters, activePerformerItems)
    ) {
      issues.push(issue(
        "error",
        "situation_cast_performer_conflict",
        "situation",
        situation.id,
        "Selected characters cannot be assigned to distinct active performer slots.",
        { relationType: "performer", characterIds: situation.characterIds || [] }
      ));
    }
    for (const slot of situation.characterSlots || []) {
      if (slot.characterId && !characterIds.has(slot.characterId)) {
        issues.push(issue(
          "error",
          "situation_slot_missing_character",
          "situation",
          situation.id,
          `Situation slot ${slot.slotIndex} references missing character ${slot.characterId}.`,
          { relationType: "character", refId: slot.characterId, slotIndex: slot.slotIndex }
        ));
      }
    }
    if (situation.environmentMode === "selected" && !situation.environmentId) {
      issues.push(issue(
        "error",
        "situation_missing_selected_environment",
        "situation",
        situation.id,
        "Situation uses selected environment mode but has no environment."
      ));
    }
    if (situation.environmentId && !environmentIds.has(situation.environmentId)) {
      issues.push(issue(
        "error",
        "situation_missing_environment",
        "situation",
        situation.id,
        `Situation references missing environment ${situation.environmentId}.`,
        { relationType: "environment", refId: situation.environmentId }
      ));
    }
    if (situation.environmentId && environmentIds.has(situation.environmentId) && !environmentActive.get(situation.environmentId)) {
      issues.push(issue(
        "warning",
        "situation_inactive_environment",
        "situation",
        situation.id,
        `Situation references inactive or archived environment ${situation.environmentId}.`,
        { relationType: "environment", refId: situation.environmentId }
      ));
    }
    for (const labelId of situation.labelIds || []) {
      if (!labelIds.has(labelId)) {
        issues.push(issue(
          "error",
          "situation_missing_label",
          "situation",
          situation.id,
          `Situation references missing label ${labelId}.`,
          { relationType: "label", refId: labelId }
        ));
      }
    }
    if (situation.contextSituationId && !situationIds.has(situation.contextSituationId)) {
      issues.push(issue(
        "error",
        "situation_missing_context",
        "situation",
        situation.id,
        `Situation references missing context situation ${situation.contextSituationId}.`,
        { relationType: "situation", refId: situation.contextSituationId }
      ));
    }
  }

  const hasV2MediaAssets = Number(readModel.counts && readModel.counts.v2MediaAssets || 0) > 0;
  if (readModel.source && readModel.source.environmentAssetMediaDirError && !hasV2MediaAssets) {
    issues.push(issue(
      "warning",
      "media_asset_directory_unavailable",
      "mediaAsset",
      "media-assets",
      `Environment asset media directory could not be scanned: ${readModel.source.environmentAssetMediaDirError}.`
    ));
  }

  for (const asset of readModel.mediaAssets || []) {
    if (!environmentIds.has(asset.environmentId)) {
      issues.push(issue(
        "error",
        "media_asset_missing_environment",
        "mediaAsset",
        asset.id,
        `Media asset references missing environment ${asset.environmentId}.`,
        { relationType: "environment", refId: asset.environmentId }
      ));
    }
    if (
      asset.status === "missing"
      && (asset.type === "background" || asset.type === "audio" || asset.type === "soundscape")
      && environmentActive.get(asset.environmentId) !== false
      && !presentMediaKeys.has(mediaPresenceKey(asset))
    ) {
      issues.push(issue(
        "info",
        "media_asset_missing_files",
        "mediaAsset",
        asset.id,
        `No ${asset.type} files found for environment ${asset.environmentName}.`,
        { relationType: "environment", refId: asset.environmentId }
      ));
    }
  }

  const counts = issues.reduce(
    (acc, current) => {
      if (current.severity === "error") acc.errors += 1;
      else if (current.severity === "warning") acc.warnings += 1;
      else acc.info += 1;
      return acc;
    },
    { errors: 0, warnings: 0, info: 0 }
  );

  return {
    ok: counts.errors === 0,
    generatedAt: new Date().toISOString(),
    schemaVersion: readModel.schemaVersion,
    source: readModel.source,
    readModelCounts: readModel.counts,
    counts,
    issues,
  };
}

module.exports = {
  validateCatalogReadModel,
};
