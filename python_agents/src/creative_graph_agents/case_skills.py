"""Load and validate compact creative-case few-shot skills."""

from __future__ import annotations

from copy import deepcopy
from importlib.resources import files
import json
from typing import Any, Literal, Mapping

from .state import CaseSkillContext, SelectedCaseSkill


SKILL_RESOURCE = "skills/creative-case-patterns/references/cases.json"
MAX_SELECTED_SKILLS = 2
CaseSkillStage = Literal["initial", "growth"]


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _load_resource() -> dict[str, Any]:
    resource = files("creative_graph_agents").joinpath(SKILL_RESOURCE)
    payload = json.loads(resource.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("skills"), list):
        raise ValueError("creative case skill resource must contain a skills list")
    return payload


def get_case_skill_catalog(
    stage: CaseSkillStage | None = None,
) -> list[dict[str, Any]]:
    """Return lightweight metadata; examples remain unloaded from model input."""

    catalog: list[dict[str, Any]] = []
    for raw in _load_resource()["skills"]:
        if not isinstance(raw, Mapping):
            continue
        skill_id = str(raw.get("skill_id", "")).strip()
        title = str(raw.get("title", "")).strip()
        stages = _string_list(raw.get("stages", []))
        if not skill_id or not title:
            continue
        if stage is not None and stage not in stages:
            continue
        catalog.append({
            "skill_id": skill_id,
            "title": title,
            "description": str(raw.get("description", "")).strip(),
            "triggers": _string_list(raw.get("triggers", [])),
            "stages": stages,
        })
    return catalog


def resolve_case_skill_context(
    selection: Mapping[str, Any],
    *,
    selection_mode: str = "auto",
    stage: CaseSkillStage | None = None,
) -> CaseSkillContext:
    """Resolve an Agent selection to trusted cards from the packaged resource."""

    payload = _load_resource()
    version = str(payload.get("catalog_version", "creative-case-patterns-v1"))
    mode = "disabled" if selection_mode == "disabled" else "auto"
    if mode == "disabled":
        return {"catalog_version": version, "selection_mode": mode, "selected": []}

    cards: dict[str, Mapping[str, Any]] = {}
    for item in payload["skills"]:
        if not isinstance(item, Mapping):
            continue
        skill_id = str(item.get("skill_id", "")).strip()
        stages = _string_list(item.get("stages", []))
        if not skill_id or (stage is not None and stage not in stages):
            continue
        cards[skill_id] = item
    raw_selected = selection.get("selected_skills", [])
    requested = raw_selected if isinstance(raw_selected, list) else []
    selected: list[SelectedCaseSkill] = []
    seen: set[str] = set()
    for raw in requested:
        if not isinstance(raw, Mapping):
            continue
        skill_id = str(raw.get("skill_id", "")).strip()
        card = cards.get(skill_id)
        if not card or skill_id in seen:
            continue
        example = card.get("example", {})
        seen.add(skill_id)
        selected.append({
            "skill_id": skill_id,
            "title": str(card.get("title", "")).strip(),
            "reason": str(raw.get("reason", "")).strip(),
            "stages": _string_list(card.get("stages", [])),
            "example": deepcopy(dict(example)) if isinstance(example, Mapping) else {},
        })
        if len(selected) >= MAX_SELECTED_SKILLS:
            break

    return {
        "catalog_version": version,
        "selection_mode": mode,
        "selected": selected,
    }
