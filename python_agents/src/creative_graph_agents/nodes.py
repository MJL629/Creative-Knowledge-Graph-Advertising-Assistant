"""LangGraph node implementations for the immutable shared-state workflow."""

from __future__ import annotations

from copy import deepcopy
from functools import wraps
import json
import re
from typing import Any, Callable, Literal, Mapping, TypeVar, cast

from .case_skills import get_case_skill_catalog, resolve_case_skill_context
from .model import JsonModel
from .prompts import (
    ADVERTISING_ANALYST_PROMPT,
    CASE_SKILL_SELECTOR_PROMPT,
    CONFLICT_ANALYST_PROMPT,
    CREATIVE_PROMPT,
    CREATIVE_REPAIR_PROMPT,
    CRITIC_PROMPT,
    NARRATIVE_ANALYST_PROMPT,
    SUBJECT_ANALYST_PROMPT,
    SUPERVISOR_PROMPT,
)
from .state import (
    AdvertisingAnalysis,
    AnalysisPlan,
    ConflictAnalysis,
    CreativeAnalyses,
    CreativeCandidate,
    CreativeDraft,
    CriticIssue,
    CriticScores,
    CritiqueResult,
    FirstRoundResult,
    NarrativeAnalysis,
    NormalizedBrief,
    RepairPlan,
    SemanticSupportLink,
    SharedState,
    StoryBlueprint,
    SubjectAnalysis,
    ValidationResult,
    empty_critique,
    empty_first_round_selection,
    empty_repair_plan,
    initialize_candidate_registry,
    initialize_first_round_selection,
    rebuild_state,
    utc_now,
    validate_complete_state,
)


class StateMutationError(RuntimeError):
    pass


NodeMethod = TypeVar("NodeMethod", bound=Callable[..., SharedState])


def immutable_full_state_node(method: NodeMethod) -> NodeMethod:
    """Runtime guard for the project's stronger-than-LangGraph node contract."""

    @wraps(method)
    def wrapped(self: Any, state: SharedState) -> SharedState:
        validate_complete_state(state)
        before = deepcopy(state)
        result = method(self, state)
        if state != before:
            raise StateMutationError(f"{method.__name__} mutated its input state")
        validate_complete_state(result)
        for field, old_value in state.items():
            if isinstance(old_value, (dict, list, set)) and result[field] is old_value:
                raise StateMutationError(
                    f"{method.__name__} reused mutable top-level field: {field}"
                )
        return result

    return cast(NodeMethod, wrapped)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[；;、,，\n]", value) if item.strip()]
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _value(raw: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in raw and raw[key] is not None:
            return raw[key]
    return default


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _score(value: Any) -> float:
    return max(0.0, min(1.0, _number(value)))


def _message(state: SharedState, node: str, content: str) -> list[dict[str, Any]]:
    return [
        *deepcopy(state["messages"]),
        {
            "role": node,
            "node": node,
            "content": content,
            "iteration": state["iteration"],
        },
    ]


def _metadata(state: SharedState, node: str, *, model_call: bool) -> dict[str, Any]:
    return {
        **deepcopy(state["metadata"]),
        "last_agent": node,
        "model_calls": int(state["metadata"].get("model_calls", 0)) + (1 if model_call else 0),
        "updated_at": utc_now(),
    }


def _normalized_brief(raw: Mapping[str, Any]) -> NormalizedBrief:
    duration = int(_number(_value(raw, "duration_seconds", "durationSeconds", default=30), 30))
    known = _value(raw, "known_facts", "knownFacts", default=[])
    known_information = _value(raw, "known_information", "knownInformation", default="")
    known_facts = _string_list(known)
    if isinstance(known_information, str) and known_information.strip():
        known_facts = [*known_facts, known_information.strip()]
    return {
        "promotion_subject": str(
            _value(raw, "promotion_subject", "product", default="")
        ).strip(),
        "known_facts": known_facts,
        "idea_fragments": _string_list(
            _value(raw, "idea_fragments", "ideaFragments", default=[])
        ),
        "must_keep": _string_list(
            _value(raw, "must_keep", "mustKeep", default=[])
        ),
        "must_avoid": _string_list(
            _value(raw, "must_avoid", "mustAvoid", "forbidden", default=[])
        ),
        "audience": str(_value(raw, "audience", default="")).strip(),
        "platform": str(_value(raw, "platform", default="抖音")).strip() or "抖音",
        "duration_seconds": max(5, min(duration, 300)),
        "styles": _string_list(_value(raw, "styles", default=[])),
        "selling_points": _string_list(
            _value(raw, "selling_points", "sellingPoints", default=[])
        ),
        "hot_memes": _string_list(
            _value(raw, "hot_memes", "hotMemes", default=[])
        ),
    }


def _plan(value: Mapping[str, Any]) -> AnalysisPlan:
    return {
        "intent": str(value.get("intent", "initial_divergence")),
        "required_facets": _string_list(
            value.get("required_facets", ["subject", "advertising", "conflict", "narrative"])
        ),
        "context_plan": _string_list(value.get("context_plan", [])),
        "risk_flags": _string_list(value.get("risk_flags", [])),
        "need_rag": bool(value.get("need_rag", False)),
        "need_memory": bool(value.get("need_memory", False)),
        "need_external_tool": bool(value.get("need_external_tool", False)),
    }


def _subject_analysis(value: Mapping[str, Any], brief: NormalizedBrief) -> SubjectAnalysis:
    protagonists = []
    for item in value.get("possible_protagonists", []):
        row = _mapping(item)
        protagonists.append(
            {
                "role": str(row.get("role", "")),
                "motivation": str(row.get("motivation", "")),
                "agency": str(row.get("agency", "")),
                "relationship_to_product": str(row.get("relationship_to_product", "")),
            }
        )
    return {
        "promotion_subject": str(
            value.get("promotion_subject", brief["promotion_subject"])
        ),
        "possible_protagonists": protagonists,
        "continuity_rules": _string_list(value.get("continuity_rules", [])),
        "subject_drift_risks": _string_list(value.get("subject_drift_risks", [])),
    }


def _advertising_analysis(value: Mapping[str, Any]) -> AdvertisingAnalysis:
    insertions = []
    for item in value.get("possible_insertions", []):
        row = _mapping(item)
        insertions.append(
            {
                "selling_point": str(row.get("selling_point", "")),
                "narrative_function": str(row.get("narrative_function", "")),
                "suitable_moment": str(row.get("suitable_moment", "")),
            }
        )
    return {
        "core_selling_points": _string_list(value.get("core_selling_points", [])),
        "product_roles": _string_list(value.get("product_roles", [])),
        "possible_insertions": insertions,
        "mandatory_messages": _string_list(value.get("mandatory_messages", [])),
        "advertising_risks": _string_list(value.get("advertising_risks", [])),
    }


def _conflict_analysis(value: Mapping[str, Any]) -> ConflictAnalysis:
    paths = []
    for item in value.get("escalation_paths", []):
        row = _mapping(item)
        paths.append(
            {
                "start": str(row.get("start", "")),
                "escalation": str(row.get("escalation", "")),
                "consequence": str(row.get("consequence", "")),
            }
        )
    return {
        "possible_goals": _string_list(value.get("possible_goals", [])),
        "possible_obstacles": _string_list(value.get("possible_obstacles", [])),
        "possible_stakes": _string_list(value.get("possible_stakes", [])),
        "escalation_paths": paths,
        "conflict_risks": _string_list(value.get("conflict_risks", [])),
    }


def _narrative_analysis(value: Mapping[str, Any]) -> NarrativeAnalysis:
    phases = []
    for item in value.get("recommended_structure", []):
        row = _mapping(item)
        phases.append(
            {
                "phase": str(row.get("phase", "")),
                "purpose": str(row.get("purpose", "")),
                "estimated_seconds": int(_number(row.get("estimated_seconds"), 0)),
            }
        )
    return {
        "recommended_structure": phases,
        "required_story_functions": _string_list(
            value.get("required_story_functions", [])
        ),
        "possible_twists": _string_list(value.get("possible_twists", [])),
        "pacing_risks": _string_list(value.get("pacing_risks", [])),
    }


def _blueprint(value: Mapping[str, Any], brief: NormalizedBrief) -> StoryBlueprint:
    return {
        "logline": str(value.get("logline", "")),
        "theme": str(value.get("theme", "")),
        "protagonist": str(value.get("protagonist", "")),
        "protagonist_goal": str(value.get("protagonist_goal", "")),
        "core_conflict": str(value.get("core_conflict", "")),
        "stakes": str(value.get("stakes", "")),
        "product_role": str(value.get("product_role", "")),
        "hook": str(value.get("hook", "")),
        "development": str(value.get("development", "")),
        "turning_point": str(value.get("turning_point", "")),
        "climax": str(value.get("climax", "")),
        "cta": str(value.get("cta", "")),
        "estimated_duration_seconds": int(
            _number(value.get("estimated_duration_seconds"), brief["duration_seconds"])
        ),
    }


def _candidate(value: Mapping[str, Any]) -> CreativeCandidate:
    category = str(value.get("category", "creative_element"))
    attributes = value.get("attributes", {})
    return cast(
        CreativeCandidate,
        {
            "client_key": str(value.get("client_key", value.get("clientKey", ""))),
            "category": category,
            "subtype": str(value.get("subtype", "")),
            "title": str(value.get("title", "")),
            "description": str(value.get("description", "")),
            "attributes": deepcopy(dict(attributes)) if isinstance(attributes, Mapping) else {},
            "rationale": str(value.get("rationale", "")),
            "actor_refs": _string_list(value.get("actor_refs", value.get("actorRefs", []))),
            "product_feature_refs": _string_list(
                value.get("product_feature_refs", value.get("productFeatureRefs", []))
            ),
        },
    )


def _support_link(value: Mapping[str, Any]) -> SemanticSupportLink:
    return {
        "from_client_key": str(
            value.get("from_client_key", value.get("fromClientKey", ""))
        ),
        "to_client_key": str(
            value.get("to_client_key", value.get("toClientKey", ""))
        ),
        "relation": str(value.get("relation", "")),
        "rationale": str(value.get("rationale", "")),
    }


def _draft(value: Mapping[str, Any], brief: NormalizedBrief) -> CreativeDraft:
    return {
        "story_blueprint": _blueprint(
            _mapping(value.get("story_blueprint", value.get("storyBlueprint", {}))),
            brief,
        ),
        "candidates": [
            _candidate(_mapping(item)) for item in value.get("candidates", [])
        ],
        "support_links": [
            _support_link(_mapping(item))
            for item in value.get("support_links", value.get("supportLinks", []))
        ],
    }


def _repair_plan(value: Mapping[str, Any]) -> RepairPlan:
    return {
        "preserve_candidate_keys": _string_list(value.get("preserve_candidate_keys", [])),
        "rewrite_candidate_keys": _string_list(value.get("rewrite_candidate_keys", [])),
        "remove_candidate_keys": _string_list(value.get("remove_candidate_keys", [])),
        "story_fields_to_repair": _string_list(value.get("story_fields_to_repair", [])),
        "missing_requirements": _string_list(value.get("missing_requirements", [])),
        "instructions": _string_list(value.get("instructions", [])),
    }


def _issue(value: Mapping[str, Any]) -> CriticIssue:
    return {
        "scope": str(value.get("scope", "story")),
        "target_key": str(value.get("target_key", "")),
        "dimension": str(value.get("dimension", "story_coherence")),
        "severity": "warning" if value.get("severity") == "warning" else "error",
        "message": str(value.get("message", "")),
        "repair_instruction": str(value.get("repair_instruction", "")),
    }


def _scores(value: Mapping[str, Any]) -> CriticScores:
    return {
        "brief_alignment": _score(value.get("brief_alignment")),
        "subject_consistency": _score(value.get("subject_consistency")),
        "story_coherence": _score(value.get("story_coherence")),
        "product_integration": _score(value.get("product_integration")),
        "novelty": _score(value.get("novelty")),
        "constraint_satisfaction": _score(value.get("constraint_satisfaction")),
        "duplicate_risk": _score(value.get("duplicate_risk")),
    }


def _critique(value: Mapping[str, Any]) -> CritiqueResult:
    return {
        "passed": bool(value.get("passed", False)),
        "scores": _scores(_mapping(value.get("scores", {}))),
        "global_issues": [
            _issue(_mapping(item)) for item in value.get("global_issues", [])
        ],
        "candidate_issues": [
            _issue(_mapping(item)) for item in value.get("candidate_issues", [])
        ],
        "repair_plan": _repair_plan(_mapping(value.get("repair_plan", {}))),
        "summary": str(value.get("summary", "")),
    }


def validate_draft(draft: CreativeDraft, brief: NormalizedBrief) -> ValidationResult:
    errors: list[str] = []
    candidates = draft["candidates"]
    categories = ("creative_element", "motivation_conflict", "story_event")
    if len(candidates) != 6:
        errors.append("候选节点必须正好为 6 个")
    for category in categories:
        if sum(item["category"] == category for item in candidates) != 2:
            errors.append(f"{category} 必须正好为 2 个")

    keys: set[str] = set()
    allowed_features = {brief["promotion_subject"], *brief["selling_points"]}
    for index, candidate in enumerate(candidates, start=1):
        key = candidate["client_key"]
        if not key or key in keys:
            errors.append(f"第 {index} 个 client_key 缺失或重复")
        keys.add(key)
        if candidate["category"] not in categories:
            errors.append(f"第 {index} 个 category 非法")
        if not candidate["title"].strip() or len(candidate["title"]) > 18:
            errors.append(f"第 {index} 个标题为空或超过 18 个字符")
        if not candidate["description"].strip():
            errors.append(f"第 {index} 个描述为空")
        if candidate["category"] != "creative_element" and not candidate["actor_refs"]:
            errors.append(f"第 {index} 个冲突或事件缺少主体引用")
        if any(ref not in allowed_features for ref in candidate["product_feature_refs"]):
            errors.append(f"第 {index} 个产品卖点引用不存在")
        combined = f"{candidate['title']} {candidate['description']}".lower()
        for forbidden in brief["must_avoid"]:
            if forbidden.lower() in combined:
                errors.append(f"第 {index} 个候选包含禁止内容：{forbidden}")

    for index, candidate in enumerate(candidates, start=1):
        if any(ref not in keys for ref in candidate["actor_refs"]):
            errors.append(f"第 {index} 个主体引用不存在于本轮候选")
    for link in draft["support_links"]:
        if link["from_client_key"] not in keys or link["to_client_key"] not in keys:
            errors.append("语义支撑关系引用了不存在的候选")

    blueprint = draft["story_blueprint"]
    for field in (
        "logline",
        "protagonist",
        "protagonist_goal",
        "core_conflict",
        "product_role",
        "hook",
        "climax",
        "cta",
    ):
        if not str(blueprint[field]).strip():
            errors.append(f"Story Blueprint 缺少 {field}")
    if blueprint["estimated_duration_seconds"] != brief["duration_seconds"]:
        errors.append("Story Blueprint 时长与 Brief 不一致")
    return {"valid": not errors, "errors": errors}


class CreativeWorkflowNodes:
    """Independent graph nodes sharing data only through SharedState."""

    def __init__(self, model: JsonModel) -> None:
        self.model = model

    @immutable_full_state_node
    def normalize_brief(self, state: SharedState) -> SharedState:
        raw = deepcopy(state["raw_brief"])
        if not raw and state["input_text"].strip():
            try:
                parsed = json.loads(state["input_text"])
                raw = deepcopy(parsed) if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                raw = {
                    "product": state["input_text"].strip(),
                    "ideaFragments": [state["input_text"].strip()],
                }
        brief = _normalized_brief(raw)
        errors = [*state["errors"]]
        if not brief["promotion_subject"]:
            errors.append("推广对象不能为空")
        if not brief["idea_fragments"]:
            errors.append("至少需要一个碎片想法")
        stage = "normalization_failed" if errors else "brief_normalized"
        return rebuild_state(
            state,
            raw_brief=raw,
            brief=brief,
            current_stage=stage,
            errors=errors,
            messages=_message(state, "normalizer", stage),
            metadata=_metadata(state, "normalizer", model_call=False),
        )

    @immutable_full_state_node
    def supervisor(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="supervisor_plan",
            system_prompt=SUPERVISOR_PROMPT,
            payload={"brief": state["brief"]},
        )
        plan = _plan(result)
        return rebuild_state(
            state,
            plan=plan,
            current_stage="analysis_planned",
            messages=_message(state, "supervisor", "分析计划已生成"),
            metadata=_metadata(state, "supervisor", model_call=True),
        )

    @immutable_full_state_node
    def select_case_skills(self, state: SharedState) -> SharedState:
        selection_mode = state["case_skill_context"]["selection_mode"]
        if selection_mode == "disabled":
            return rebuild_state(
                state,
                case_skill_context=resolve_case_skill_context(
                    {}, selection_mode="disabled", stage="initial"
                ),
                current_stage="case_skills_disabled",
                messages=_message(state, "case_skill_selector", "案例技能已禁用"),
                metadata=_metadata(state, "case_skill_selector", model_call=False),
            )

        try:
            result = self.model.generate_json(
                task="select_case_skills",
                system_prompt=CASE_SKILL_SELECTOR_PROMPT,
                payload={
                    "brief": state["brief"],
                    "plan": state["plan"],
                    "skill_catalog": get_case_skill_catalog("initial"),
                    "selection_limit": 2,
                },
            )
        except Exception as error:
            return rebuild_state(
                state,
                case_skill_context=resolve_case_skill_context(
                    {},
                    selection_mode="auto",
                    stage="initial",
                ),
                current_stage="case_skills_degraded",
                messages=_message(
                    state,
                    "case_skill_selector",
                    "案例技能选择暂不可用，已跳过案例参考",
                ),
                errors=[
                    *state["errors"],
                    f"case skill selector skipped: {type(error).__name__}",
                ],
                metadata=_metadata(state, "case_skill_selector", model_call=True),
            )
        context = resolve_case_skill_context(
            result,
            selection_mode="auto",
            stage="initial",
        )
        selected_ids = [item["skill_id"] for item in context["selected"]]
        summary = (
            f"已选择案例技能：{', '.join(selected_ids)}"
            if selected_ids
            else "没有匹配的案例技能"
        )
        return rebuild_state(
            state,
            case_skill_context=context,
            current_stage="case_skills_selected",
            messages=_message(state, "case_skill_selector", summary),
            metadata=_metadata(state, "case_skill_selector", model_call=True),
        )

    @immutable_full_state_node
    def subject_analyst(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="subject_analysis",
            system_prompt=SUBJECT_ANALYST_PROMPT,
            payload={"brief": state["brief"], "plan": state["plan"]},
        )
        analyses: CreativeAnalyses = {
            **deepcopy(state["analyses"]),
            "subject": _subject_analysis(result, state["brief"]),
        }
        return rebuild_state(
            state,
            analyses=analyses,
            current_stage="subject_analyzed",
            messages=_message(state, "subject_analyst", "主体与人物分析完成"),
            metadata=_metadata(state, "subject_analyst", model_call=True),
        )

    @immutable_full_state_node
    def advertising_analyst(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="advertising_analysis",
            system_prompt=ADVERTISING_ANALYST_PROMPT,
            payload={
                "brief": state["brief"],
                "plan": state["plan"],
                "subject_analysis": state["analyses"]["subject"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        analyses: CreativeAnalyses = {
            **deepcopy(state["analyses"]),
            "advertising": _advertising_analysis(result),
        }
        return rebuild_state(
            state,
            analyses=analyses,
            current_stage="advertising_analyzed",
            messages=_message(state, "advertising_analyst", "广告目标与产品分析完成"),
            metadata=_metadata(state, "advertising_analyst", model_call=True),
        )

    @immutable_full_state_node
    def conflict_analyst(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="conflict_analysis",
            system_prompt=CONFLICT_ANALYST_PROMPT,
            payload={
                "brief": state["brief"],
                "analyses": state["analyses"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        analyses: CreativeAnalyses = {
            **deepcopy(state["analyses"]),
            "conflict": _conflict_analysis(result),
        }
        return rebuild_state(
            state,
            analyses=analyses,
            current_stage="conflict_analyzed",
            messages=_message(state, "conflict_analyst", "动机与冲突分析完成"),
            metadata=_metadata(state, "conflict_analyst", model_call=True),
        )

    @immutable_full_state_node
    def narrative_analyst(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="narrative_analysis",
            system_prompt=NARRATIVE_ANALYST_PROMPT,
            payload={
                "brief": state["brief"],
                "analyses": state["analyses"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        analyses: CreativeAnalyses = {
            **deepcopy(state["analyses"]),
            "narrative": _narrative_analysis(result),
        }
        return rebuild_state(
            state,
            analyses=analyses,
            current_stage="narrative_analyzed",
            messages=_message(state, "narrative_analyst", "剧情结构与节奏分析完成"),
            metadata=_metadata(state, "narrative_analyst", model_call=True),
        )

    @immutable_full_state_node
    def creative(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="creative_initial",
            system_prompt=CREATIVE_PROMPT,
            payload={
                "brief": state["brief"],
                "plan": state["plan"],
                "analyses": state["analyses"],
                "case_skill_context": state["case_skill_context"],
                "required_output": {
                    "story_blueprint": "StoryBlueprint",
                    "candidates": "exactly 6; two per category",
                    "support_links": "semantic candidate links",
                },
            },
        )
        draft = _draft(result, state["brief"])
        return rebuild_state(
            state,
            draft=draft,
            validation={"valid": False, "errors": []},
            critique=empty_critique(),
            repair_plan=empty_repair_plan(),
            current_stage="creative_draft_generated",
            messages=_message(state, "creative", "首轮 Story Blueprint 与候选已生成"),
            metadata=_metadata(state, "creative", model_call=True),
        )

    @immutable_full_state_node
    def creative_repair(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="creative_repair",
            system_prompt=CREATIVE_REPAIR_PROMPT,
            payload={
                "brief": state["brief"],
                "analyses": state["analyses"],
                "previous_draft": state["draft"],
                "critique": state["critique"],
                "repair_plan": state["repair_plan"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        draft = _draft(result, state["brief"])
        next_iteration = state["iteration"] + 1
        next_state = rebuild_state(
            state,
            draft=draft,
            validation={"valid": False, "errors": []},
            current_stage="creative_draft_repaired",
            iteration=next_iteration,
            messages=_message(state, "creative_repair", f"完成第 {next_iteration} 次局部修复"),
            metadata=_metadata(state, "creative_repair", model_call=True),
        )
        return next_state

    @immutable_full_state_node
    def validator(self, state: SharedState) -> SharedState:
        validation = validate_draft(state["draft"], state["brief"])
        stage = "draft_validated" if validation["valid"] else "draft_validation_failed"
        return rebuild_state(
            state,
            validation=validation,
            current_stage=stage,
            messages=_message(state, "validator", stage),
            metadata=_metadata(state, "validator", model_call=False),
        )

    @immutable_full_state_node
    def critic(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="critic_review",
            system_prompt=CRITIC_PROMPT,
            payload={
                "brief": state["brief"],
                "analyses": state["analyses"],
                "draft": state["draft"],
                "validation": state["validation"],
                "iteration": state["iteration"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        critique = _critique(result)
        if not state["validation"]["valid"]:
            validation_issues: list[CriticIssue] = [
                {
                    "scope": "story",
                    "target_key": "",
                    "dimension": "schema_validation",
                    "severity": "error",
                    "message": error,
                    "repair_instruction": "按照确定性校验要求修复结构",
                }
                for error in state["validation"]["errors"]
            ]
            candidate_keys = [item["client_key"] for item in state["draft"]["candidates"]]
            critique = {
                **critique,
                "passed": False,
                "global_issues": [*validation_issues, *critique["global_issues"]],
                "repair_plan": {
                    **critique["repair_plan"],
                    "rewrite_candidate_keys": candidate_keys,
                    "instructions": [
                        *critique["repair_plan"]["instructions"],
                        "先修复全部确定性结构错误",
                    ],
                },
            }
        has_error = any(
            issue["severity"] == "error"
            for issue in [*critique["global_issues"], *critique["candidate_issues"]]
        )
        critique = {**critique, "passed": bool(critique["passed"] and not has_error)}
        stage = "critic_passed" if critique["passed"] else "critic_rejected"
        return rebuild_state(
            state,
            critique=critique,
            repair_plan=critique["repair_plan"],
            current_stage=stage,
            messages=_message(state, "critic", critique["summary"] or stage),
            metadata=_metadata(state, "critic", model_call=True),
        )

    @immutable_full_state_node
    def finalize(self, state: SharedState) -> SharedState:
        if state["errors"] and not state["draft"]["candidates"]:
            status: Literal["failed", "ready_for_selection", "needs_review"] = "failed"
        elif state["critique"]["passed"]:
            status = "ready_for_selection"
        else:
            status = "needs_review"
        result: FirstRoundResult = {
            "status": status,
            "story_hypothesis": deepcopy(state["draft"]["story_blueprint"]),
            "candidates": deepcopy(state["draft"]["candidates"]),
            "support_links": deepcopy(state["draft"]["support_links"]),
            "critique": deepcopy(state["critique"]),
            "iteration_count": state["iteration"],
        }
        return rebuild_state(
            state,
            final_result=result,
            first_round_selection=(
                initialize_first_round_selection(result["candidates"])
                if result["candidates"]
                else empty_first_round_selection()
            ),
            candidate_registry=(
                initialize_candidate_registry(
                    result["candidates"],
                    first_round_run_id=state["task_id"],
                )
                if result["candidates"]
                else state["candidate_registry"]
            ),
            current_stage="completed" if status != "failed" else "failed",
            messages=_message(state, "finalizer", f"首轮流程结束：{status}"),
            metadata=_metadata(state, "finalizer", model_call=False),
        )


def route_after_normalize(state: SharedState) -> Literal["supervisor", "finalize"]:
    return "finalize" if state["current_stage"] == "normalization_failed" else "supervisor"


def route_after_critic(state: SharedState) -> Literal["creative_repair", "finalize"]:
    if state["critique"]["passed"]:
        return "finalize"
    if state["iteration"] < state["max_iterations"]:
        return "creative_repair"
    return "finalize"
