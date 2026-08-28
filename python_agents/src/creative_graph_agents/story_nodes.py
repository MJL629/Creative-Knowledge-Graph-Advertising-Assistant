"""Immutable LangGraph nodes for adopted-subgraph Story Convergence."""

from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Literal, Mapping, cast

from .model import JsonModel
from .nodes import immutable_full_state_node
from .prompts import (
    STORY_CRITIC_PROMPT,
    STORY_DRAFT_OUTPUT_CONTRACT,
    STORY_PLAN_OUTPUT_CONTRACT,
    STORY_PLANNER_PROMPT,
    STORY_REPAIR_PROMPT,
    STORY_WRITER_PROMPT,
)
from .state import (
    SharedState,
    StoryBeat,
    StoryContext,
    StoryCritique,
    StoryDraft,
    StoryPhase,
    StoryPlan,
    StoryReadiness,
    StoryReadinessIssue,
    StoryRepairPlan,
    StoryResult,
    StoryScores,
    StorySegment,
    StoryValidation,
    StoryValidationIssue,
    empty_story_critique,
    empty_story_draft,
    empty_story_repair_plan,
    empty_story_validation,
    rebuild_state,
    rebuild_story,
    utc_now,
)


STORY_PHASES = {
    "hook",
    "setup",
    "development",
    "turning_point",
    "climax",
    "cta",
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


def _phase(value: Any) -> StoryPhase:
    phase = str(value)
    return cast(StoryPhase, phase if phase in STORY_PHASES else "development")


def _story_message(state: SharedState, node: str, content: str) -> list[dict[str, Any]]:
    return [
        *deepcopy(state["messages"]),
        {
            "role": node,
            "node": node,
            "content": content,
            "iteration": state["story"]["repair_iteration"],
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


def _readiness_issue(
    *,
    code: str,
    message: str,
    suggested_action: str,
    node_ids: list[str] | None = None,
    severity: Literal["warning", "error"] = "error",
) -> StoryReadinessIssue:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "node_ids": deepcopy(node_ids or []),
        "suggested_action": suggested_action,
    }


def _validation_issue(
    *,
    code: str,
    message: str,
    repair_instruction: str,
    segment_id: str = "",
    node_ids: list[str] | None = None,
    severity: Literal["warning", "error"] = "error",
) -> StoryValidationIssue:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "segment_id": segment_id,
        "node_ids": deepcopy(node_ids or []),
        "repair_instruction": repair_instruction,
    }


def _story_beat(value: Mapping[str, Any]) -> StoryBeat:
    try:
        seconds = int(value.get("estimated_seconds", 0))
    except (TypeError, ValueError):
        seconds = 0
    return {
        "beat_id": str(value.get("beat_id", "")),
        "phase": _phase(value.get("phase")),
        "purpose": str(value.get("purpose", "")),
        "estimated_seconds": max(0, seconds),
        "node_refs": _string_list(value.get("node_refs", [])),
        "relation_refs": _string_list(value.get("relation_refs", [])),
        "product_feature_refs": _string_list(value.get("product_feature_refs", [])),
        "planned_content": str(value.get("planned_content", "")),
    }


def _story_plan(value: Mapping[str, Any]) -> StoryPlan:
    beats = [_story_beat(_mapping(item)) for item in value.get("beats", [])]
    raw_coverage = value.get("node_coverage", {})
    coverage = {
        str(node_id): _string_list(beat_ids)
        for node_id, beat_ids in (
            raw_coverage.items() if isinstance(raw_coverage, Mapping) else []
        )
    }
    try:
        total_seconds = int(value.get("total_estimated_seconds", 0))
    except (TypeError, ValueError):
        total_seconds = 0
    return {
        "title": str(value.get("title", "")),
        "logline": str(value.get("logline", "")),
        "theme": str(value.get("theme", "")),
        "beats": beats,
        "required_node_ids": _string_list(value.get("required_node_ids", [])),
        "node_coverage": coverage,
        "total_estimated_seconds": total_seconds,
    }


def _story_segment(value: Mapping[str, Any]) -> StorySegment:
    try:
        seconds = int(value.get("estimated_seconds", 0))
    except (TypeError, ValueError):
        seconds = 0
    return {
        "segment_id": str(value.get("segment_id", value.get("beat_id", ""))),
        "phase": _phase(value.get("phase")),
        "estimated_seconds": max(0, seconds),
        "node_refs": _string_list(value.get("node_refs", [])),
        "relation_refs": _string_list(value.get("relation_refs", [])),
        "product_feature_refs": _string_list(value.get("product_feature_refs", [])),
        "text": str(value.get("text", "")),
    }


def _story_draft(value: Mapping[str, Any]) -> StoryDraft:
    try:
        duration = int(value.get("estimated_duration_seconds", 0))
    except (TypeError, ValueError):
        duration = 0
    return {
        "title": str(value.get("title", "")),
        "logline": str(value.get("logline", "")),
        "synopsis": str(value.get("synopsis", "")),
        "segments": [
            _story_segment(_mapping(item)) for item in value.get("segments", [])
        ],
        "full_script": str(value.get("full_script", "")),
        "cta": str(value.get("cta", "")),
        "used_node_ids": _string_list(value.get("used_node_ids", [])),
        "used_edge_ids": _string_list(value.get("used_edge_ids", [])),
        "estimated_duration_seconds": max(0, duration),
    }


def _story_scores(value: Mapping[str, Any]) -> StoryScores:
    return {
        "adopted_node_coverage": _score(value.get("adopted_node_coverage")),
        "subject_consistency": _score(value.get("subject_consistency")),
        "causal_coherence": _score(value.get("causal_coherence")),
        "narrative_pacing": _score(value.get("narrative_pacing")),
        "product_integration": _score(value.get("product_integration")),
        "style_alignment": _score(value.get("style_alignment")),
        "platform_fit": _score(value.get("platform_fit")),
        "constraint_satisfaction": _score(value.get("constraint_satisfaction")),
    }


def _story_repair_plan(value: Mapping[str, Any]) -> StoryRepairPlan:
    return {
        "preserve_beat_ids": _string_list(value.get("preserve_beat_ids", [])),
        "rewrite_beat_ids": _string_list(value.get("rewrite_beat_ids", [])),
        "missing_node_ids": _string_list(value.get("missing_node_ids", [])),
        "remove_unapproved_facts": _string_list(
            value.get("remove_unapproved_facts", [])
        ),
        "instructions": _string_list(value.get("instructions", [])),
    }


def _story_critique(value: Mapping[str, Any]) -> StoryCritique:
    issues: list[StoryValidationIssue] = []
    for item in value.get("issues", []):
        row = _mapping(item)
        issues.append(
            _validation_issue(
                code=str(row.get("code", "semantic_review")),
                severity="warning" if row.get("severity") == "warning" else "error",
                message=str(row.get("message", "")),
                segment_id=str(row.get("segment_id", "")),
                node_ids=_string_list(row.get("node_ids", [])),
                repair_instruction=str(row.get("repair_instruction", "")),
            )
        )
    return {
        "passed": bool(value.get("passed", False)),
        "scores": _story_scores(_mapping(value.get("scores", {}))),
        "issues": issues,
        "repair_plan": _story_repair_plan(_mapping(value.get("repair_plan", {}))),
        "summary": str(value.get("summary", "")),
    }


def validate_story_draft(state: SharedState) -> StoryValidation:
    story = state["story"]
    context = story["context"]
    plan = story["plan"]
    draft = story["draft"]
    issues: list[StoryValidationIssue] = []

    adopted_ids = {node["node_id"] for node in context["adopted_nodes"]}
    adopted_edge_ids = {edge["edge_id"] for edge in context["adopted_edges"]}
    segment_refs = {
        node_id for segment in draft["segments"] for node_id in segment["node_refs"]
    }
    declared_used = set(draft["used_node_ids"])
    used_ids = segment_refs | declared_used
    unknown_node_refs = sorted(used_ids - adopted_ids)
    required_ids = adopted_ids if story["request"]["require_all_adopted_nodes"] else set(
        plan["required_node_ids"]
    )
    unused_ids = sorted(required_ids - segment_refs)

    if not draft["title"].strip() or not draft["full_script"].strip():
        issues.append(
            _validation_issue(
                code="missing_story_content",
                message="Story 缺少标题或完整正文",
                repair_instruction="返回完整标题、分段和 full_script",
            )
        )
    if not draft["segments"]:
        issues.append(
            _validation_issue(
                code="missing_segments",
                message="Story 没有任何 Segment",
                repair_instruction="按照 Story Plan 返回完整分段",
            )
        )
    if unknown_node_refs:
        issues.append(
            _validation_issue(
                code="unknown_node_refs",
                message="Story 引用了未采用或不存在的节点",
                node_ids=unknown_node_refs,
                repair_instruction="删除未知引用，只使用 adopted_nodes",
            )
        )
    if unused_ids:
        issues.append(
            _validation_issue(
                code="adopted_node_not_covered",
                message="部分已采用节点没有出现在任何 Story Segment",
                node_ids=unused_ids,
                repair_instruction="把缺失节点加入合适的 Story Beat",
            )
        )
    if declared_used != segment_refs:
        issues.append(
            _validation_issue(
                code="used_node_ids_mismatch",
                message="used_node_ids 与 Segment 实际引用不一致",
                node_ids=sorted(declared_used ^ segment_refs),
                repair_instruction="根据 Segment node_refs 重新生成 used_node_ids",
            )
        )

    unknown_edges = sorted(set(draft["used_edge_ids"]) - adopted_edge_ids)
    for segment in draft["segments"]:
        unknown_edges.extend(
            edge_id
            for edge_id in segment["relation_refs"]
            if edge_id not in adopted_edge_ids
        )
    if unknown_edges:
        issues.append(
            _validation_issue(
                code="unknown_relation_refs",
                message="Story 引用了不存在的正式关系",
                repair_instruction="只引用 adopted_edges",
            )
        )

    allowed_features = {
        context["promotion_subject"],
        *context["selling_points"],
    }
    feature_refs = {
        ref for segment in draft["segments"] for ref in segment["product_feature_refs"]
    }
    if not feature_refs:
        issues.append(
            _validation_issue(
                code="product_not_integrated",
                message="Story Segment 没有引用产品或卖点",
                repair_instruction="让 adopted 节点通过产品卖点参与剧情因果",
            )
        )
    invalid_features = sorted(feature_refs - allowed_features)
    if invalid_features:
        issues.append(
            _validation_issue(
                code="unknown_product_feature",
                message="Story 引用了 Brief 中不存在的产品卖点",
                repair_instruction="只引用 promotion_subject 或 selling_points",
            )
        )

    if draft["estimated_duration_seconds"] != context["duration_seconds"]:
        issues.append(
            _validation_issue(
                code="duration_mismatch",
                message="Story 估算时长与 Brief 不一致",
                repair_instruction=f"总时长必须为 {context['duration_seconds']} 秒",
            )
        )
    segment_seconds = sum(item["estimated_seconds"] for item in draft["segments"])
    if segment_seconds != context["duration_seconds"]:
        issues.append(
            _validation_issue(
                code="segment_duration_mismatch",
                message="所有 Segment 时长之和与 Brief 不一致",
                repair_instruction="重新分配 Segment estimated_seconds",
            )
        )
    if not draft["cta"].strip():
        issues.append(
            _validation_issue(
                code="missing_cta",
                message="Story 缺少 CTA",
                repair_instruction="补充与故事和产品自然衔接的 CTA",
            )
        )

    combined_text = f"{draft['synopsis']} {draft['full_script']} {draft['cta']}".lower()
    for forbidden in context["must_avoid"]:
        if forbidden.lower() in combined_text:
            issues.append(
                _validation_issue(
                    code="must_avoid_violation",
                    message=f"Story 包含禁止内容：{forbidden}",
                    repair_instruction="删除禁止内容并保持 adopted 节点事实",
                )
            )

    forbidden_candidate_ids: list[str] = []
    registry = state["candidate_registry"]
    for candidate_id in registry["rejected_ids"]:
        record = registry["candidates"].get(candidate_id)
        if record and record["title"].strip() and record["title"].lower() in combined_text:
            forbidden_candidate_ids.append(candidate_id)
    if forbidden_candidate_ids:
        issues.append(
            _validation_issue(
                code="rejected_candidate_used",
                message="Story 使用了用户拒绝的候选内容",
                repair_instruction="删除 rejected 候选，只使用 adopted 子图",
            )
        )

    error_issues = [item for item in issues if item["severity"] == "error"]
    return {
        "valid": not error_issues,
        "issues": issues,
        "unused_adopted_node_ids": unused_ids,
        "unknown_node_refs": unknown_node_refs,
        "forbidden_candidate_ids": forbidden_candidate_ids,
    }


class StoryWorkflowNodes:
    """Story agents communicate only through the complete SharedState."""

    def __init__(self, model: JsonModel) -> None:
        self.model = model

    @immutable_full_state_node
    def validate_request(self, state: SharedState) -> SharedState:
        request = state["story"]["request"]
        errors: list[str] = []
        if state["workflow_phase"] != "story_convergence":
            errors.append("当前 State 不是 story_convergence 阶段")
        if request["base_graph_version"] != state["graph_snapshot"]["graph_version"]:
            errors.append("图谱版本已变化，请刷新后重新生成 Story")
        if not state["graph_snapshot"]["nodes"]:
            errors.append("没有已采用节点，无法生成 Story")
        if state["candidate_registry"]["pending_ids"]:
            errors.append("仍有 pending 候选，请先逐个采用或拒绝")
        stage = "story_request_invalid" if errors else "story_request_validated"
        return rebuild_state(
            state,
            current_stage=stage,
            errors=errors,
            messages=_story_message(state, "story_request_validator", stage),
            metadata=_metadata(state, "story_request_validator", model_call=False),
        )

    @immutable_full_state_node
    def build_context(self, state: SharedState) -> SharedState:
        registry = state["candidate_registry"]
        rejected_signatures = [
            f"{registry['candidates'][candidate_id]['title']} "
            f"{registry['candidates'][candidate_id]['description']}"
            for candidate_id in registry["rejected_ids"]
            if candidate_id in registry["candidates"]
        ]
        context: StoryContext = {
            "graph_version": state["graph_snapshot"]["graph_version"],
            "adopted_nodes": deepcopy(state["graph_snapshot"]["nodes"]),
            "adopted_edges": deepcopy(state["graph_snapshot"]["edges"]),
            "promotion_subject": state["brief"]["promotion_subject"],
            "canonical_protagonist": state["final_result"]["story_hypothesis"][
                "protagonist"
            ],
            "must_keep": deepcopy(state["brief"]["must_keep"]),
            "must_avoid": deepcopy(state["brief"]["must_avoid"]),
            "selling_points": deepcopy(state["brief"]["selling_points"]),
            "platform": state["brief"]["platform"],
            "duration_seconds": state["brief"]["duration_seconds"],
            "styles": deepcopy(state["brief"]["styles"]),
            "first_round_blueprint": deepcopy(
                state["final_result"]["story_hypothesis"]
            ),
            "rejected_signatures": rejected_signatures,
        }
        story = rebuild_story(state["story"], context=context)
        return rebuild_state(
            state,
            story=story,
            current_stage="story_context_built",
            messages=_story_message(state, "story_context_builder", "adopted 子图已投影"),
            metadata=_metadata(state, "story_context_builder", model_call=False),
        )

    @immutable_full_state_node
    def health_check(self, state: SharedState) -> SharedState:
        context = state["story"]["context"]
        nodes = context["adopted_nodes"]
        edges = context["adopted_edges"]
        blocking: list[StoryReadinessIssue] = []
        warnings: list[StoryReadinessIssue] = []
        missing_functions: list[str] = []
        categories = {node["category"] for node in nodes}
        required_categories = {
            "creative_element": "主体或创意元素",
            "motivation_conflict": "动机与冲突",
            "story_event": "剧情事件",
        }
        for category, label in required_categories.items():
            if category not in categories:
                missing_functions.append(label)
                blocking.append(
                    _readiness_issue(
                        code=f"missing_{category}",
                        message=f"adopted 子图缺少{label}",
                        suggested_action=f"继续生长并采用一个{label}节点",
                    )
                )
        if not any(node["product_feature_refs"] for node in nodes):
            missing_functions.append("产品叙事作用")
            blocking.append(
                _readiness_issue(
                    code="missing_product_integration",
                    message="adopted 子图没有节点引用产品或卖点",
                    suggested_action="采用一个能够展示产品卖点的节点",
                )
            )

        connected_ids = {
            endpoint
            for edge in edges
            for endpoint in (edge["from_node_id"], edge["to_node_id"])
        }
        orphan_ids = [node["node_id"] for node in nodes if node["node_id"] not in connected_ids]
        if orphan_ids and len(nodes) > 1:
            warnings.append(
                _readiness_issue(
                    code="orphan_nodes",
                    severity="warning",
                    message="部分 adopted 节点没有正式关系连接",
                    node_ids=orphan_ids,
                    suggested_action="补充关系或由 Story Planner 仅添加叙事过渡",
                )
            )

        estimated_seconds = max(5, len(nodes) * 4)
        if estimated_seconds > context["duration_seconds"]:
            blocking.append(
                _readiness_issue(
                    code="duration_overflow",
                    message="全部 adopted 节点无法在目标时长内清晰表达",
                    node_ids=[node["node_id"] for node in nodes],
                    suggested_action="减少 adopted 节点或增加视频时长",
                )
            )
        readiness: StoryReadiness = {
            "ready": not blocking,
            "blocking_issues": blocking,
            "warnings": warnings,
            "orphan_node_ids": orphan_ids,
            "conflicting_node_ids": [],
            "missing_story_functions": missing_functions,
            "estimated_required_seconds": estimated_seconds,
            "available_seconds": context["duration_seconds"],
        }
        story = rebuild_story(state["story"], readiness=readiness)
        stage = "story_ready" if readiness["ready"] else "story_needs_more_nodes"
        return rebuild_state(
            state,
            story=story,
            current_stage=stage,
            messages=_story_message(state, "story_health_check", stage),
            metadata=_metadata(state, "story_health_check", model_call=False),
        )

    @immutable_full_state_node
    def planner(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="story_plan",
            system_prompt=f"{STORY_PLANNER_PROMPT}\n\n{STORY_PLAN_OUTPUT_CONTRACT}",
            payload={
                "request": state["story"]["request"],
                "context": state["story"]["context"],
                "readiness": state["story"]["readiness"],
            },
        )
        plan = _story_plan(result)
        story = rebuild_story(
            state["story"],
            plan=plan,
            draft=empty_story_draft(),
            validation=empty_story_validation(),
            critique=empty_story_critique(),
            repair_plan=empty_story_repair_plan(),
        )
        return rebuild_state(
            state,
            story=story,
            current_stage="story_planned",
            messages=_story_message(state, "story_planner", "Story Beats 已规划"),
            metadata=_metadata(state, "story_planner", model_call=True),
        )

    @immutable_full_state_node
    def writer(self, state: SharedState) -> SharedState:
        result = self.model.generate_json(
            task="story_write",
            system_prompt=f"{STORY_WRITER_PROMPT}\n\n{STORY_DRAFT_OUTPUT_CONTRACT}",
            payload={
                "request": state["story"]["request"],
                "context": state["story"]["context"],
                "story_plan": state["story"]["plan"],
            },
        )
        draft = _story_draft(result)
        story = rebuild_story(state["story"], draft=draft)
        return rebuild_state(
            state,
            story=story,
            current_stage="story_draft_written",
            messages=_story_message(state, "story_writer", "StoryDraft 已生成"),
            metadata=_metadata(state, "story_writer", model_call=True),
        )

    @immutable_full_state_node
    def validator(self, state: SharedState) -> SharedState:
        validation = validate_story_draft(state)
        story = rebuild_story(state["story"], validation=validation)
        stage = "story_validated" if validation["valid"] else "story_validation_failed"
        return rebuild_state(
            state,
            story=story,
            current_stage=stage,
            messages=_story_message(state, "story_validator", stage),
            metadata=_metadata(state, "story_validator", model_call=False),
        )

    @immutable_full_state_node
    def critic(self, state: SharedState) -> SharedState:
        story = state["story"]
        result = self.model.generate_json(
            task="story_critic",
            system_prompt=STORY_CRITIC_PROMPT,
            payload={
                "request": story["request"],
                "context": story["context"],
                "story_plan": story["plan"],
                "story_draft": story["draft"],
                "validation": story["validation"],
                "repair_iteration": story["repair_iteration"],
            },
        )
        critique = _story_critique(result)
        if not story["validation"]["valid"]:
            validation_errors = [
                item
                for item in story["validation"]["issues"]
                if item["severity"] == "error"
            ]
            all_beat_ids = [beat["beat_id"] for beat in story["plan"]["beats"]]
            targeted = {
                item["segment_id"] for item in validation_errors if item["segment_id"]
            }
            rewrite_ids = sorted(targeted) if targeted else all_beat_ids
            critique = {
                **critique,
                "passed": False,
                "issues": [*validation_errors, *critique["issues"]],
                "repair_plan": {
                    "preserve_beat_ids": [
                        beat_id for beat_id in all_beat_ids if beat_id not in rewrite_ids
                    ],
                    "rewrite_beat_ids": rewrite_ids,
                    "missing_node_ids": deepcopy(
                        story["validation"]["unused_adopted_node_ids"]
                    ),
                    "remove_unapproved_facts": deepcopy(
                        story["validation"]["forbidden_candidate_ids"]
                    ),
                    "instructions": [
                        *critique["repair_plan"]["instructions"],
                        "先修复 deterministic Story Validation 中的全部 error",
                    ],
                },
            }
        has_error = any(item["severity"] == "error" for item in critique["issues"])
        critique = {**critique, "passed": bool(critique["passed"] and not has_error)}
        next_story = rebuild_story(
            story,
            critique=critique,
            repair_plan=critique["repair_plan"],
        )
        stage = "story_critic_passed" if critique["passed"] else "story_critic_rejected"
        return rebuild_state(
            state,
            story=next_story,
            current_stage=stage,
            messages=_story_message(state, "story_critic", critique["summary"] or stage),
            metadata=_metadata(state, "story_critic", model_call=True),
        )

    @immutable_full_state_node
    def repair(self, state: SharedState) -> SharedState:
        story = state["story"]
        result = self.model.generate_json(
            task="story_repair",
            system_prompt=f"{STORY_REPAIR_PROMPT}\n\n{STORY_DRAFT_OUTPUT_CONTRACT}",
            payload={
                "request": story["request"],
                "context": story["context"],
                "story_plan": story["plan"],
                "previous_draft": story["draft"],
                "validation": story["validation"],
                "critique": story["critique"],
                "repair_plan": story["repair_plan"],
            },
        )
        draft = _story_draft(result)
        next_iteration = story["repair_iteration"] + 1
        next_story = rebuild_story(
            story,
            draft=draft,
            validation=empty_story_validation(),
            repair_iteration=next_iteration,
        )
        return rebuild_state(
            state,
            story=next_story,
            current_stage="story_repaired",
            messages=_story_message(
                state,
                "story_repair",
                f"完成第 {next_iteration} 次 Story Beat 修复",
            ),
            metadata=_metadata(state, "story_repair", model_call=True),
        )

    @immutable_full_state_node
    def finalize(self, state: SharedState) -> SharedState:
        story = state["story"]
        if state["errors"]:
            status: Literal["ready", "needs_more_nodes", "needs_review", "failed"] = (
                "failed"
            )
        elif not story["readiness"]["ready"]:
            status = "needs_more_nodes"
        elif story["critique"]["passed"]:
            status = "ready"
        else:
            status = "needs_review"
        result: StoryResult = {
            "status": status,
            "graph_version": story["request"]["base_graph_version"],
            "title": story["draft"]["title"],
            "logline": story["draft"]["logline"],
            "synopsis": story["draft"]["synopsis"],
            "full_script": story["draft"]["full_script"],
            "cta": story["draft"]["cta"],
            "segments": deepcopy(story["draft"]["segments"]),
            "used_node_ids": deepcopy(story["draft"]["used_node_ids"]),
            "used_edge_ids": deepcopy(story["draft"]["used_edge_ids"]),
            "unused_adopted_node_ids": deepcopy(
                story["validation"]["unused_adopted_node_ids"]
            ),
            "readiness": deepcopy(story["readiness"]),
            "validation": deepcopy(story["validation"]),
            "critique": deepcopy(story["critique"]),
            "iteration_count": story["repair_iteration"],
        }
        next_story = rebuild_story(story, result=result)
        return rebuild_state(
            state,
            story=next_story,
            current_stage="story_completed" if status != "failed" else "story_failed",
            messages=_story_message(state, "story_finalizer", f"Story 流程结束：{status}"),
            metadata=_metadata(state, "story_finalizer", model_call=False),
        )


def route_after_story_request(
    state: SharedState,
) -> Literal["build_story_context", "finalize_story"]:
    return (
        "finalize_story"
        if state["current_stage"] == "story_request_invalid"
        else "build_story_context"
    )


def route_after_story_readiness(
    state: SharedState,
) -> Literal["story_planner", "finalize_story"]:
    return "story_planner" if state["story"]["readiness"]["ready"] else "finalize_story"


def route_after_story_critic(
    state: SharedState,
) -> Literal["story_repair", "finalize_story"]:
    story = state["story"]
    if story["critique"]["passed"]:
        return "finalize_story"
    if story["repair_iteration"] < story["max_repair_iterations"]:
        return "story_repair"
    return "finalize_story"
