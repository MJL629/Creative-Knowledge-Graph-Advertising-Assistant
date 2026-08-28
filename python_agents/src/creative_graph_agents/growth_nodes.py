"""Immutable LangGraph nodes for controlled creative graph growth."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Literal, Mapping, cast

from .model import JsonModel
from .nodes import immutable_full_state_node
from .prompts import (
    GROWTH_CRITIC_PROMPT,
    GROWTH_DIRECTION_PROMPTS,
    GROWTH_OUTPUT_CONTRACT,
    GROWTH_REPAIR_PROMPT,
    GROWTH_SYSTEM_PROMPT,
)
from .state import (
    CandidateSummary,
    CreativeCategory,
    GraphGapAnalysis,
    GraphNodeSnapshot,
    GrowthCandidate,
    GrowthConflict,
    GrowthContext,
    GrowthCritique,
    GrowthDirection,
    GrowthDraft,
    GrowthPlan,
    GrowthRepairPlan,
    GrowthResult,
    GrowthScores,
    GrowthValidation,
    ProposedRelation,
    SharedState,
    empty_growth_critique,
    empty_growth_repair_plan,
    empty_growth_validation,
    rebuild_growth,
    rebuild_state,
    register_growth_candidates,
    utc_now,
)


CREATIVE_CATEGORIES = (
    "creative_element",
    "motivation_conflict",
    "story_event",
)
FORCED_DIRECTION_CATEGORY: dict[GrowthDirection, CreativeCategory] = {
    "generate_followup_event": "story_event",
    "add_obstacle": "motivation_conflict",
    "add_character_or_prop": "creative_element",
}
DIRECTION_GOALS: dict[GrowthDirection, str] = {
    "deepen_current": "补充机制、细节和作用，不改变种子节点核心含义",
    "generate_followup_event": "承接种子节点的因果结果并推动主体继续行动",
    "add_obstacle": "围绕主体目标增加可以升级且有代价的阻碍",
    "add_character_or_prop": "增加有明确叙事功能且不抢走主体的人物或道具",
    "generate_reversal": "利用已有设定重新解释局面并推动新的主体行动",
    "create_parallel_plan": "从相同起点和目标创建机制不同的独立分支",
}
DIRECTION_RELATIONS: dict[GrowthDirection, list[str]] = {
    "deepen_current": ["elaborates", "details", "manifests", "reveals_detail"],
    "generate_followup_event": ["causes", "leads_to", "precedes", "triggers"],
    "add_obstacle": ["obstructs", "threatens", "escalates", "prevents"],
    "add_character_or_prop": ["used_by", "appears_in", "enables", "supports"],
    "generate_reversal": ["reveals", "reverses", "reinterprets", "triggers"],
    "create_parallel_plan": ["branches_from", "alternative_to", "parallel_to"],
}


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[；;、,，\n]", value) if item.strip()]
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _score(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0.0
    return max(0.0, min(1.0, number))


def _normalized_text(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", value).lower()


def _growth_message(state: SharedState, node: str, content: str) -> list[dict[str, Any]]:
    return [
        *deepcopy(state["messages"]),
        {
            "role": node,
            "node": node,
            "content": content,
            "iteration": state["growth"]["repair_iteration"],
        },
    ]


def _metadata(state: SharedState, node: str, *, model_call: bool) -> dict[str, Any]:
    return {
        **deepcopy(state["metadata"]),
        "last_agent": node,
        "model_calls": int(state["metadata"].get("model_calls", 0))
        + (1 if model_call else 0),
        "updated_at": utc_now(),
    }


def _conflict(
    *,
    conflict_type: str,
    candidate_key: str,
    message: str,
    repair_instruction: str,
    conflicting_ref: str = "",
    severity: Literal["warning", "error"] = "error",
) -> GrowthConflict:
    allowed = {
        "id_collision",
        "exact_duplicate",
        "semantic_duplicate",
        "canonical_contradiction",
        "relation_duplicate",
        "self_relation",
        "invalid_reference",
        "category_mismatch",
        "subject_drift",
        "constraint_violation",
        "schema_validation",
    }
    normalized_type = conflict_type if conflict_type in allowed else "schema_validation"
    return cast(
        GrowthConflict,
        {
            "conflict_type": normalized_type,
            "severity": severity,
            "candidate_key": candidate_key,
            "conflicting_ref": conflicting_ref,
            "message": message,
            "repair_instruction": repair_instruction,
        },
    )


def _proposed_relation(value: Mapping[str, Any]) -> ProposedRelation:
    return {
        "from_ref": str(value.get("from_ref", "")),
        "to_ref": str(value.get("to_ref", "")),
        "relation": str(value.get("relation", "")),
        "rationale": str(value.get("rationale", "")),
    }


def _growth_candidate(
    value: Mapping[str, Any],
    *,
    run_id: str,
    seed_node_id: str,
    direction: GrowthDirection,
) -> GrowthCandidate:
    local_key = str(value.get("local_key", value.get("client_key", ""))).strip()
    category = str(value.get("category", "creative_element"))
    blueprint_patch = value.get("blueprint_patch", {})
    seed_refs = _string_list(value.get("seed_node_refs", []))
    return cast(
        GrowthCandidate,
        {
            "candidate_id": f"growth:{run_id}:{local_key}",
            "local_key": local_key,
            "growth_run_id": run_id,
            "seed_node_id": seed_node_id,
            "seed_node_refs": seed_refs,
            "direction": direction,
            "category": category,
            "subtype": str(value.get("subtype", "")),
            "title": str(value.get("title", "")).strip(),
            "description": str(value.get("description", "")).strip(),
            "actor_refs": _string_list(value.get("actor_refs", [])),
            "product_feature_refs": _string_list(value.get("product_feature_refs", [])),
            "proposed_relations": [
                _proposed_relation(_mapping(item))
                for item in value.get("proposed_relations", [])
            ],
            "rationale": str(value.get("rationale", "")).strip(),
            "story_effect": str(value.get("story_effect", "")).strip(),
            "risk_flags": _string_list(value.get("risk_flags", [])),
            "lineage": {
                "root_first_round_node_id": seed_node_id,
                "parent_node_ids": [seed_node_id],
                "growth_run_id": run_id,
                "generation_direction": direction,
            },
            "blueprint_patch": (
                deepcopy(dict(blueprint_patch))
                if isinstance(blueprint_patch, Mapping)
                else {}
            ),
        },
    )


def _growth_draft(value: Mapping[str, Any], state: SharedState) -> GrowthDraft:
    request = state["growth"]["request"]
    return {
        "new_candidates": [
            _growth_candidate(
                _mapping(item),
                run_id=request["growth_run_id"],
                seed_node_id=request["seed_node_id"],
                direction=request["direction"],
            )
            for item in value.get("candidates", [])
        ]
    }


def _growth_scores(value: Mapping[str, Any]) -> GrowthScores:
    return {
        "anchor_alignment": _score(value.get("anchor_alignment")),
        "continuity": _score(value.get("continuity")),
        "graph_gain": _score(value.get("graph_gain")),
        "story_progress": _score(value.get("story_progress")),
        "product_integration": _score(value.get("product_integration")),
        "novelty": _score(value.get("novelty")),
        "relation_quality": _score(value.get("relation_quality")),
        "duplicate_risk": _score(value.get("duplicate_risk")),
    }


def _growth_repair_plan(value: Mapping[str, Any]) -> GrowthRepairPlan:
    return {
        "preserve_candidate_keys": _string_list(value.get("preserve_candidate_keys", [])),
        "rewrite_candidate_keys": _string_list(value.get("rewrite_candidate_keys", [])),
        "instructions": _string_list(value.get("instructions", [])),
    }


def _growth_critique(value: Mapping[str, Any]) -> GrowthCritique:
    return {
        "passed": bool(value.get("passed", False)),
        "scores": _growth_scores(_mapping(value.get("scores", {}))),
        "issues": [
            _conflict(
                conflict_type=str(row.get("conflict_type", "schema_validation")),
                severity="warning" if row.get("severity") == "warning" else "error",
                candidate_key=str(row.get("candidate_key", "")),
                conflicting_ref=str(row.get("conflicting_ref", "")),
                message=str(row.get("message", "")),
                repair_instruction=str(row.get("repair_instruction", "")),
            )
            for row in (_mapping(item) for item in value.get("issues", []))
        ],
        "repair_plan": _growth_repair_plan(_mapping(value.get("repair_plan", {}))),
        "summary": str(value.get("summary", "")),
    }


def _resolve_category(
    direction: GrowthDirection,
    requested: CreativeCategory | None,
    seed_category: CreativeCategory,
) -> CreativeCategory:
    if direction in FORCED_DIRECTION_CATEGORY:
        return FORCED_DIRECTION_CATEGORY[direction]
    if direction == "generate_reversal":
        return requested or "story_event"
    return requested or seed_category


def validate_growth_draft(state: SharedState) -> GrowthValidation:
    growth = state["growth"]
    candidates = growth["draft"]["new_candidates"]
    request = growth["request"]
    context = growth["context"]
    plan = growth["plan"]
    conflicts: list[GrowthConflict] = []

    if len(candidates) != request["candidate_count"]:
        conflicts.append(
            _conflict(
                conflict_type="schema_validation",
                candidate_key="",
                message=f"必须生成 {request['candidate_count']} 个生长候选",
                repair_instruction="按 candidate_count 返回完整候选列表",
            )
        )

    initial_summaries = context["initial_candidate_summaries"]
    existing_title_map = {
        _normalized_text(item["title"]): item["client_key"]
        for item in initial_summaries
        if item["title"].strip()
    }
    existing_description_map = {
        _normalized_text(item["description"]): item["client_key"]
        for item in initial_summaries
        if item["description"].strip()
    }
    existing_keys = {
        item["client_key"] for item in initial_summaries
    } | {node["node_id"] for node in context["adopted_nodes"]}
    adopted_ids = {node["node_id"] for node in context["adopted_nodes"]}
    local_keys = [candidate["local_key"] for candidate in candidates]
    local_key_set = set(local_keys)
    allowed_refs = adopted_ids | local_key_set
    allowed_features = {
        state["brief"]["promotion_subject"],
        *state["brief"]["selling_points"],
    }

    for index, candidate in enumerate(candidates, start=1):
        key = candidate["local_key"]
        if (
            not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", key)
            or local_keys.count(key) > 1
            or key in existing_keys
        ):
            conflicts.append(
                _conflict(
                    conflict_type="id_collision",
                    candidate_key=key,
                    conflicting_ref=key,
                    message=(
                        f"第 {index} 个候选 local_key 格式非法、重复或与历史标识冲突"
                    ),
                    repair_instruction="为本轮候选生成新的唯一 local_key",
                )
            )
        expected_id = f"growth:{request['growth_run_id']}:{key}"
        if candidate["candidate_id"] != expected_id:
            conflicts.append(
                _conflict(
                    conflict_type="id_collision",
                    candidate_key=key,
                    message="candidate_id 不属于当前 growth_run_id 命名空间",
                    repair_instruction="由后端重新构造 candidate_id",
                )
            )
        if candidate["category"] != plan["resolved_category"]:
            conflicts.append(
                _conflict(
                    conflict_type="category_mismatch",
                    candidate_key=key,
                    message="候选分类与当前生长方向解析结果不一致",
                    repair_instruction=f"category 必须为 {plan['resolved_category']}",
                )
            )
        if not candidate["title"] or len(candidate["title"]) > 18:
            conflicts.append(
                _conflict(
                    conflict_type="schema_validation",
                    candidate_key=key,
                    message="标题为空或超过 18 个字符",
                    repair_instruction="生成简短且唯一的中文标题",
                )
            )
        if not candidate["description"] or not candidate["story_effect"]:
            conflicts.append(
                _conflict(
                    conflict_type="schema_validation",
                    candidate_key=key,
                    message="候选缺少 description 或 story_effect",
                    repair_instruction="补充完整内容和剧情作用",
                )
            )
        normalized_title = _normalized_text(candidate["title"])
        normalized_description = _normalized_text(candidate["description"])
        if normalized_title in existing_title_map:
            conflicts.append(
                _conflict(
                    conflict_type="exact_duplicate",
                    candidate_key=key,
                    conflicting_ref=existing_title_map[normalized_title],
                    message="候选标题与首轮候选重复",
                    repair_instruction="保留方向目标，重新设计不同机制和标题",
                )
            )
        if normalized_description in existing_description_map:
            conflicts.append(
                _conflict(
                    conflict_type="exact_duplicate",
                    candidate_key=key,
                    conflicting_ref=existing_description_map[normalized_description],
                    message="候选描述与首轮候选重复",
                    repair_instruction="生成具有新图谱增量的内容",
                )
            )
        if request["seed_node_id"] not in candidate["seed_node_refs"]:
            conflicts.append(
                _conflict(
                    conflict_type="invalid_reference",
                    candidate_key=key,
                    conflicting_ref=request["seed_node_id"],
                    message="候选没有引用当前种子节点",
                    repair_instruction="在 seed_node_refs 中加入种子节点 ID",
                )
            )
        if candidate["category"] != "creative_element" and not candidate["actor_refs"]:
            conflicts.append(
                _conflict(
                    conflict_type="subject_drift",
                    candidate_key=key,
                    message="冲突或事件没有行动主体引用",
                    repair_instruction="引用已有主体，并说明其主动行动",
                )
            )
        for ref in candidate["actor_refs"]:
            if ref not in allowed_refs:
                conflicts.append(
                    _conflict(
                        conflict_type="invalid_reference",
                        candidate_key=key,
                        conflicting_ref=ref,
                        message="actor_refs 引用了不存在的节点",
                        repair_instruction="只引用 adopted 节点或本轮 local_key",
                    )
                )
        for ref in candidate["product_feature_refs"]:
            if ref not in allowed_features:
                conflicts.append(
                    _conflict(
                        conflict_type="invalid_reference",
                        candidate_key=key,
                        conflicting_ref=ref,
                        message="product_feature_refs 引用了不存在的卖点",
                        repair_instruction="只引用 Brief 中存在的产品或卖点",
                    )
                )
        combined = f"{candidate['title']} {candidate['description']}".lower()
        for forbidden in state["brief"]["must_avoid"]:
            if forbidden.lower() in combined:
                conflicts.append(
                    _conflict(
                        conflict_type="constraint_violation",
                        candidate_key=key,
                        conflicting_ref=forbidden,
                        message=f"候选包含禁止内容：{forbidden}",
                        repair_instruction="删除禁止内容并保留生长方向",
                    )
                )
        for rejected in context["rejected_signatures"]:
            normalized_rejected = _normalized_text(rejected)
            if normalized_rejected and normalized_rejected in _normalized_text(combined):
                conflicts.append(
                    _conflict(
                        conflict_type="semantic_duplicate",
                        candidate_key=key,
                        conflicting_ref=rejected,
                        message="候选重复了用户明确拒绝的方向",
                        repair_instruction="使用完全不同的创意机制",
                    )
                )

        has_seed_relation = False
        for relation in candidate["proposed_relations"]:
            if relation["from_ref"] == relation["to_ref"]:
                conflicts.append(
                    _conflict(
                        conflict_type="self_relation",
                        candidate_key=key,
                        message="拟议关系不能是自环",
                        repair_instruction="连接种子节点与新候选",
                    )
                )
            for ref in (relation["from_ref"], relation["to_ref"]):
                if ref not in allowed_refs:
                    conflicts.append(
                        _conflict(
                            conflict_type="invalid_reference",
                            candidate_key=key,
                            conflicting_ref=ref,
                            message="拟议关系引用了不存在的节点",
                            repair_instruction="只使用种子、adopted 节点和本轮 local_key",
                        )
                    )
            endpoints = {relation["from_ref"], relation["to_ref"]}
            if {request["seed_node_id"], key}.issubset(endpoints):
                has_seed_relation = True
            if relation["relation"] not in plan["allowed_relations"]:
                conflicts.append(
                    _conflict(
                        conflict_type="relation_duplicate",
                        severity="warning",
                        candidate_key=key,
                        conflicting_ref=relation["relation"],
                        message="关系类型不在当前方向的推荐集合中",
                        repair_instruction="优先使用 GrowthPlan.allowed_relations",
                    )
                )
        if not has_seed_relation:
            conflicts.append(
                _conflict(
                    conflict_type="invalid_reference",
                    candidate_key=key,
                    conflicting_ref=request["seed_node_id"],
                    message="没有一条关系直接连接种子节点和当前候选",
                    repair_instruction="增加 seed_node 与 local_key 的直接关系",
                )
            )

    errors = [item for item in conflicts if item["severity"] == "error"]
    warnings = [item["message"] for item in conflicts if item["severity"] == "warning"]
    return {"valid": not errors, "conflicts": conflicts, "warnings": warnings}


class GrowthWorkflowNodes:
    """Growth agents communicate only through the complete SharedState."""

    def __init__(self, model: JsonModel) -> None:
        self.model = model

    @immutable_full_state_node
    def validate_request(self, state: SharedState) -> SharedState:
        request = state["growth"]["request"]
        errors: list[str] = []
        if state["workflow_phase"] != "growth":
            errors.append("当前 State 不是 growth 阶段")
        if request["base_graph_version"] != state["graph_snapshot"]["graph_version"]:
            errors.append("图谱版本已变化，请刷新后重新发起生长")
        seed = next(
            (
                node
                for node in state["graph_snapshot"]["nodes"]
                if node["node_id"] == request["seed_node_id"]
            ),
            None,
        )
        if seed is None:
            errors.append("种子节点不存在或尚未采用")
        else:
            requested = request["requested_category"]
            forced = FORCED_DIRECTION_CATEGORY.get(request["direction"])
            if forced is not None and requested is not None and requested != forced:
                errors.append(
                    f"{request['direction']} 只能生成 {forced}，不能生成 {requested}"
                )
            if (
                request["direction"] == "generate_reversal"
                and requested == "creative_element"
            ):
                errors.append("生成反转只能选择剧情事件或动机与冲突")
        stage = "growth_request_invalid" if errors else "growth_request_validated"
        validation = state["growth"]["validation"]
        if errors:
            validation = {
                "valid": False,
                "conflicts": [
                    _conflict(
                        conflict_type="schema_validation",
                        candidate_key="",
                        message=error,
                        repair_instruction="修正生长请求后重新提交",
                    )
                    for error in errors
                ],
                "warnings": [],
            }
        growth = rebuild_growth(state["growth"], validation=validation)
        return rebuild_state(
            state,
            growth=growth,
            current_stage=stage,
            errors=errors,
            messages=_growth_message(state, "growth_request_validator", stage),
            metadata=_metadata(state, "growth_request_validator", model_call=False),
        )

    @immutable_full_state_node
    def build_context(self, state: SharedState) -> SharedState:
        request = state["growth"]["request"]
        nodes = state["graph_snapshot"]["nodes"]
        edges = state["graph_snapshot"]["edges"]
        seed = next(node for node in nodes if node["node_id"] == request["seed_node_id"])
        neighbor_ids: set[str] = set()
        ancestor_ids: set[str] = set()
        for edge in edges:
            if edge["from_node_id"] == seed["node_id"]:
                neighbor_ids.add(edge["to_node_id"])
            if edge["to_node_id"] == seed["node_id"]:
                neighbor_ids.add(edge["from_node_id"])
                ancestor_ids.add(edge["from_node_id"])
        neighbor_nodes = [node for node in nodes if node["node_id"] in neighbor_ids]
        ancestor_nodes = [node for node in nodes if node["node_id"] in ancestor_ids]

        decisions = state["first_round_selection"]["decisions"]
        summaries: list[CandidateSummary] = [
            {
                "client_key": item["client_key"],
                "category": item["category"],
                "title": item["title"],
                "description": item["description"],
                "decision_status": decisions.get(
                    item["client_key"],
                    {
                        "client_key": item["client_key"],
                        "status": "pending",
                        "adopted_node_id": "",
                        "decided_by": "",
                        "decided_at": "",
                        "rejection_reason": "",
                    },
                )["status"],
            }
            for item in state["final_result"]["candidates"]
        ]
        rejected_signatures = [
            f"{item['title']} {item['description']}"
            for item in summaries
            if item["decision_status"] == "rejected"
        ]
        context: GrowthContext = {
            "seed_node": deepcopy(seed),
            "adopted_nodes": deepcopy(nodes),
            "adopted_edges": deepcopy(edges),
            "neighbor_nodes": deepcopy(neighbor_nodes),
            "ancestor_nodes": deepcopy(ancestor_nodes),
            "initial_candidate_summaries": summaries,
            "rejected_signatures": rejected_signatures,
            "promotion_subject": state["brief"]["promotion_subject"],
            "canonical_protagonist": state["final_result"]["story_hypothesis"][
                "protagonist"
            ],
            "continuity_rules": deepcopy(state["analyses"]["subject"]["continuity_rules"]),
            "must_keep": deepcopy(state["brief"]["must_keep"]),
            "must_avoid": deepcopy(state["brief"]["must_avoid"]),
            "current_blueprint": deepcopy(state["final_result"]["story_hypothesis"]),
            "open_conflicts": [
                node["node_id"]
                for node in nodes
                if node["category"] == "motivation_conflict"
            ],
            "event_timeline": [
                node["node_id"] for node in nodes if node["category"] == "story_event"
            ],
        }
        growth = rebuild_growth(state["growth"], context=context)
        return rebuild_state(
            state,
            growth=growth,
            current_stage="growth_context_built",
            messages=_growth_message(state, "growth_context_builder", "生长上下文已构建"),
            metadata=_metadata(state, "growth_context_builder", model_call=False),
        )

    @immutable_full_state_node
    def analyze_gap(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        context = growth["context"]
        request = growth["request"]
        seed = context["seed_node"]
        present_categories = {node["category"] for node in context["adopted_nodes"]}
        missing = cast(
            list[CreativeCategory],
            [category for category in CREATIVE_CATEGORIES if category not in present_categories],
        )
        recommended = _resolve_category(
            request["direction"],
            request["requested_category"],
            seed["category"],
        )
        product_gaps = []
        if not any(node["product_feature_refs"] for node in context["adopted_nodes"]):
            product_gaps.append("已采用图谱还没有节点明确引用产品卖点")
        analysis: GraphGapAnalysis = {
            "missing_categories": missing,
            "unresolved_conflict_ids": deepcopy(context["open_conflicts"]),
            "subject_drift_risks": deepcopy(
                state["analyses"]["subject"]["subject_drift_risks"]
            ),
            "product_integration_gaps": product_gaps,
            "recommended_category": recommended,
            "summary": f"从“{seed['title']}”按 {request['direction']} 生成 {recommended}",
        }
        next_growth = rebuild_growth(growth, gap_analysis=analysis)
        return rebuild_state(
            state,
            growth=next_growth,
            current_stage="growth_gap_analyzed",
            messages=_growth_message(state, "graph_gap_analyzer", analysis["summary"]),
            metadata=_metadata(state, "graph_gap_analyzer", model_call=False),
        )

    @immutable_full_state_node
    def plan_growth(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        request = growth["request"]
        context = growth["context"]
        resolved = growth["gap_analysis"]["recommended_category"]
        specialist = {
            "add_obstacle": "conflict_analyst",
            "generate_followup_event": "narrative_analyst",
            "generate_reversal": "narrative_analyst",
            "add_character_or_prop": "subject_analyst",
        }.get(request["direction"], "none")
        must_introduce = [request["additional_requirements"]] if request["additional_requirements"] else []
        plan: GrowthPlan = {
            "growth_goal": DIRECTION_GOALS[request["direction"]],
            "resolved_category": resolved,
            "allowed_relations": deepcopy(DIRECTION_RELATIONS[request["direction"]]),
            "must_preserve": [
                context["promotion_subject"],
                context["canonical_protagonist"],
                *context["continuity_rules"],
                *context["must_keep"],
            ],
            "must_introduce": must_introduce,
            "must_not_introduce": deepcopy(context["must_avoid"]),
            "candidate_strategies": [
                "coherent_continuation",
                "surprising_reversal",
                "product_amplification",
            ],
            "required_specialist": specialist,
        }
        next_growth = rebuild_growth(growth, plan=plan)
        return rebuild_state(
            state,
            growth=next_growth,
            current_stage="growth_planned",
            messages=_growth_message(state, "growth_supervisor", "生长计划已生成"),
            metadata=_metadata(state, "growth_supervisor", model_call=False),
        )

    @immutable_full_state_node
    def creative(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        request = growth["request"]
        direction_prompt = GROWTH_DIRECTION_PROMPTS[request["direction"]]
        result = self.model.generate_json(
            task="growth_generate",
            system_prompt=(
                f"{GROWTH_SYSTEM_PROMPT}\n\n{direction_prompt}\n\n"
                f"{GROWTH_OUTPUT_CONTRACT}"
            ),
            payload={
                "request": request,
                "seed_node": growth["context"]["seed_node"],
                "hard_constraints": {
                    "promotion_subject": state["brief"]["promotion_subject"],
                    "must_keep": state["brief"]["must_keep"],
                    "must_avoid": state["brief"]["must_avoid"],
                    "selling_points": state["brief"]["selling_points"],
                    "audience": state["brief"]["audience"],
                    "platform": state["brief"]["platform"],
                    "duration_seconds": state["brief"]["duration_seconds"],
                },
                "canonical_context": growth["context"],
                "comparison_candidates": growth["context"][
                    "initial_candidate_summaries"
                ],
                "rejected_signatures": growth["context"]["rejected_signatures"],
                "gap_analysis": growth["gap_analysis"],
                "growth_plan": growth["plan"],
                "case_skill_context": state["case_skill_context"],
                "candidate_count": request["candidate_count"],
            },
        )
        draft = _growth_draft(result, state)
        next_growth = rebuild_growth(
            growth,
            draft=draft,
            validation=empty_growth_validation(),
            critique=empty_growth_critique(),
            repair_plan=empty_growth_repair_plan(),
        )
        return rebuild_state(
            state,
            growth=next_growth,
            current_stage="growth_candidates_generated",
            messages=_growth_message(state, "growth_creative", "生长候选已生成"),
            metadata=_metadata(state, "growth_creative", model_call=True),
        )

    @immutable_full_state_node
    def repair(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        request = growth["request"]
        direction_prompt = GROWTH_DIRECTION_PROMPTS[request["direction"]]
        result = self.model.generate_json(
            task="growth_repair",
            system_prompt=f"{GROWTH_REPAIR_PROMPT}\n\n{direction_prompt}\n\n{GROWTH_OUTPUT_CONTRACT}",
            payload={
                "request": request,
                "brief": state["brief"],
                "context": growth["context"],
                "growth_plan": growth["plan"],
                "previous_draft": growth["draft"],
                "deterministic_validation": growth["validation"],
                "critique": growth["critique"],
                "repair_plan": growth["repair_plan"],
                "case_skill_context": state["case_skill_context"],
                "candidate_count": request["candidate_count"],
            },
        )
        draft = _growth_draft(result, state)
        next_iteration = growth["repair_iteration"] + 1
        next_growth = rebuild_growth(
            growth,
            draft=draft,
            validation=empty_growth_validation(),
            repair_iteration=next_iteration,
        )
        return rebuild_state(
            state,
            growth=next_growth,
            current_stage="growth_repaired",
            messages=_growth_message(
                state,
                "growth_repair",
                f"完成第 {next_iteration} 次生长候选修复",
            ),
            metadata=_metadata(state, "growth_repair", model_call=True),
        )

    @immutable_full_state_node
    def validator(self, state: SharedState) -> SharedState:
        validation = validate_growth_draft(state)
        stage = "growth_validated" if validation["valid"] else "growth_validation_failed"
        growth = rebuild_growth(state["growth"], validation=validation)
        return rebuild_state(
            state,
            growth=growth,
            current_stage=stage,
            messages=_growth_message(state, "growth_validator", stage),
            metadata=_metadata(state, "growth_validator", model_call=False),
        )

    @immutable_full_state_node
    def critic(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        direction_prompt = GROWTH_DIRECTION_PROMPTS[growth["request"]["direction"]]
        result = self.model.generate_json(
            task="growth_critic",
            system_prompt=f"{GROWTH_CRITIC_PROMPT}\n\n{direction_prompt}",
            payload={
                "brief": state["brief"],
                "request": growth["request"],
                "context": growth["context"],
                "growth_plan": growth["plan"],
                "draft": growth["draft"],
                "validation": growth["validation"],
                "repair_iteration": growth["repair_iteration"],
                "case_skill_context": state["case_skill_context"],
            },
        )
        critique = _growth_critique(result)
        if not growth["validation"]["valid"]:
            validation_errors = [
                item
                for item in growth["validation"]["conflicts"]
                if item["severity"] == "error"
            ]
            invalid_keys = {
                item["candidate_key"]
                for item in validation_errors
                if item["candidate_key"]
            }
            if not invalid_keys:
                invalid_keys = {
                    item["local_key"] for item in growth["draft"]["new_candidates"]
                }
            all_keys = {
                item["local_key"] for item in growth["draft"]["new_candidates"]
            }
            critique = {
                **critique,
                "passed": False,
                "issues": [*validation_errors, *critique["issues"]],
                "repair_plan": {
                    "preserve_candidate_keys": sorted(all_keys - invalid_keys),
                    "rewrite_candidate_keys": sorted(invalid_keys),
                    "instructions": [
                        *critique["repair_plan"]["instructions"],
                        "先修复 deterministic_validation 中的全部 error",
                    ],
                },
            }
        has_error = any(item["severity"] == "error" for item in critique["issues"])
        critique = {**critique, "passed": bool(critique["passed"] and not has_error)}
        stage = "growth_critic_passed" if critique["passed"] else "growth_critic_rejected"
        next_growth = rebuild_growth(
            growth,
            critique=critique,
            repair_plan=critique["repair_plan"],
        )
        return rebuild_state(
            state,
            growth=next_growth,
            current_stage=stage,
            messages=_growth_message(state, "growth_critic", critique["summary"] or stage),
            metadata=_metadata(state, "growth_critic", model_call=True),
        )

    @immutable_full_state_node
    def finalize(self, state: SharedState) -> SharedState:
        growth = state["growth"]
        if state["errors"] or not growth["draft"]["new_candidates"]:
            status: Literal["failed", "ready_for_selection", "needs_review"] = "failed"
        elif growth["critique"]["passed"]:
            status = "ready_for_selection"
        else:
            status = "needs_review"
        result: GrowthResult = {
            "status": status,
            "selection_status": "pending",
            "adopted_candidate_id": "",
            "adopted_node_id": "",
            "growth_run_id": growth["request"]["growth_run_id"],
            "seed_node_id": growth["request"]["seed_node_id"],
            "direction": growth["request"]["direction"],
            "resolved_category": growth["plan"]["resolved_category"],
            "candidates": deepcopy(growth["draft"]["new_candidates"]),
            "validation": deepcopy(growth["validation"]),
            "critique": deepcopy(growth["critique"]),
            "iteration_count": growth["repair_iteration"],
            "base_graph_version": growth["request"]["base_graph_version"],
        }
        next_growth = rebuild_growth(growth, result=result)
        registry = (
            register_growth_candidates(
                state["candidate_registry"],
                result["candidates"],
            )
            if result["candidates"]
            else state["candidate_registry"]
        )
        return rebuild_state(
            state,
            growth=next_growth,
            candidate_registry=registry,
            current_stage="growth_completed" if status != "failed" else "growth_failed",
            messages=_growth_message(state, "growth_finalizer", f"生长流程结束：{status}"),
            metadata=_metadata(state, "growth_finalizer", model_call=False),
        )


def route_after_growth_request(
    state: SharedState,
) -> Literal["build_context", "finalize_growth"]:
    return (
        "finalize_growth"
        if state["current_stage"] == "growth_request_invalid"
        else "build_context"
    )


def route_after_growth_critic(
    state: SharedState,
) -> Literal["growth_repair", "finalize_growth"]:
    growth = state["growth"]
    if growth["critique"]["passed"]:
        return "finalize_growth"
    if growth["repair_iteration"] < growth["max_repair_iterations"]:
        return "growth_repair"
    return "finalize_growth"
