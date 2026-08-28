"""Typed shared state and immutable reconstruction helpers.

Every LangGraph node in this package receives and returns ``SharedState``.
The helpers in this module deliberately impose a stricter contract than
LangGraph itself: nodes must return every state key, and mutable values are
deep-copied before they enter the new state.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Literal, Mapping, TypedDict, cast


CreativeCategory = Literal[
    "creative_element",
    "motivation_conflict",
    "story_event",
]
WorkflowStatus = Literal[
    "pending",
    "ready_for_selection",
    "needs_review",
    "failed",
]


class AgentMessage(TypedDict):
    role: str
    node: str
    content: str
    iteration: int


class NormalizedBrief(TypedDict):
    promotion_subject: str
    known_facts: list[str]
    idea_fragments: list[str]
    must_keep: list[str]
    must_avoid: list[str]
    audience: str
    platform: str
    duration_seconds: int
    styles: list[str]
    selling_points: list[str]
    hot_memes: list[str]


class AnalysisPlan(TypedDict):
    intent: str
    required_facets: list[str]
    context_plan: list[str]
    risk_flags: list[str]
    need_rag: bool
    need_memory: bool
    need_external_tool: bool


class SelectedCaseSkill(TypedDict):
    skill_id: str
    title: str
    reason: str
    stages: list[str]
    example: dict[str, Any]


class CaseSkillContext(TypedDict):
    catalog_version: str
    selection_mode: Literal["auto", "disabled"]
    selected: list[SelectedCaseSkill]


class ProtagonistOption(TypedDict):
    role: str
    motivation: str
    agency: str
    relationship_to_product: str


class SubjectAnalysis(TypedDict):
    promotion_subject: str
    possible_protagonists: list[ProtagonistOption]
    continuity_rules: list[str]
    subject_drift_risks: list[str]


class ProductInsertion(TypedDict):
    selling_point: str
    narrative_function: str
    suitable_moment: str


class AdvertisingAnalysis(TypedDict):
    core_selling_points: list[str]
    product_roles: list[str]
    possible_insertions: list[ProductInsertion]
    mandatory_messages: list[str]
    advertising_risks: list[str]


class EscalationPath(TypedDict):
    start: str
    escalation: str
    consequence: str


class ConflictAnalysis(TypedDict):
    possible_goals: list[str]
    possible_obstacles: list[str]
    possible_stakes: list[str]
    escalation_paths: list[EscalationPath]
    conflict_risks: list[str]


class NarrativePhase(TypedDict):
    phase: str
    purpose: str
    estimated_seconds: int


class NarrativeAnalysis(TypedDict):
    recommended_structure: list[NarrativePhase]
    required_story_functions: list[str]
    possible_twists: list[str]
    pacing_risks: list[str]


class CreativeAnalyses(TypedDict):
    subject: SubjectAnalysis
    advertising: AdvertisingAnalysis
    conflict: ConflictAnalysis
    narrative: NarrativeAnalysis


class StoryBlueprint(TypedDict):
    logline: str
    theme: str
    protagonist: str
    protagonist_goal: str
    core_conflict: str
    stakes: str
    product_role: str
    hook: str
    development: str
    turning_point: str
    climax: str
    cta: str
    estimated_duration_seconds: int


class CreativeCandidate(TypedDict):
    client_key: str
    category: CreativeCategory
    subtype: str
    title: str
    description: str
    attributes: dict[str, Any]
    rationale: str
    actor_refs: list[str]
    product_feature_refs: list[str]


class SemanticSupportLink(TypedDict):
    from_client_key: str
    to_client_key: str
    relation: str
    rationale: str


class CreativeDraft(TypedDict):
    story_blueprint: StoryBlueprint
    candidates: list[CreativeCandidate]
    support_links: list[SemanticSupportLink]


class ValidationResult(TypedDict):
    valid: bool
    errors: list[str]


class CriticScores(TypedDict):
    brief_alignment: float
    subject_consistency: float
    story_coherence: float
    product_integration: float
    novelty: float
    constraint_satisfaction: float
    duplicate_risk: float


class CriticIssue(TypedDict):
    scope: str
    target_key: str
    dimension: str
    severity: Literal["warning", "error"]
    message: str
    repair_instruction: str


class RepairPlan(TypedDict):
    preserve_candidate_keys: list[str]
    rewrite_candidate_keys: list[str]
    remove_candidate_keys: list[str]
    story_fields_to_repair: list[str]
    missing_requirements: list[str]
    instructions: list[str]


class CritiqueResult(TypedDict):
    passed: bool
    scores: CriticScores
    global_issues: list[CriticIssue]
    candidate_issues: list[CriticIssue]
    repair_plan: RepairPlan
    summary: str


class FirstRoundResult(TypedDict):
    status: WorkflowStatus
    story_hypothesis: StoryBlueprint
    candidates: list[CreativeCandidate]
    support_links: list[SemanticSupportLink]
    critique: CritiqueResult
    iteration_count: int


CandidateDecisionStatus = Literal[
    "pending",
    "adopted",
    "rejected",
    "superseded",
]
GrowthDirection = Literal[
    "deepen_current",
    "generate_followup_event",
    "add_obstacle",
    "add_character_or_prop",
    "generate_reversal",
    "create_parallel_plan",
]


class CandidateDecision(TypedDict):
    client_key: str
    status: CandidateDecisionStatus
    adopted_node_id: str
    decided_by: str
    decided_at: str
    rejection_reason: str


class FirstRoundSelection(TypedDict):
    status: Literal["not_ready", "pending", "partial", "completed"]
    decisions: dict[str, CandidateDecision]
    adopted_client_keys: list[str]
    rejected_client_keys: list[str]
    adopted_node_id_map: dict[str, str]


class GraphNodeSnapshot(TypedDict):
    node_id: str
    source_client_key: str
    category: CreativeCategory
    subtype: str
    title: str
    description: str
    attributes: dict[str, Any]
    actor_refs: list[str]
    product_feature_refs: list[str]


class GraphEdgeSnapshot(TypedDict):
    edge_id: str
    from_node_id: str
    to_node_id: str
    relation: str
    rationale: str


class GraphSnapshot(TypedDict):
    graph_version: int
    nodes: list[GraphNodeSnapshot]
    edges: list[GraphEdgeSnapshot]


class GrowthRequest(TypedDict):
    growth_run_id: str
    seed_node_id: str
    seed_node_version: int
    direction: GrowthDirection
    requested_category: CreativeCategory | None
    additional_requirements: str
    candidate_count: int
    base_graph_version: int
    first_round_run_id: str


class CandidateSummary(TypedDict):
    client_key: str
    category: CreativeCategory
    title: str
    description: str
    decision_status: CandidateDecisionStatus


class GrowthContext(TypedDict):
    seed_node: GraphNodeSnapshot
    adopted_nodes: list[GraphNodeSnapshot]
    adopted_edges: list[GraphEdgeSnapshot]
    neighbor_nodes: list[GraphNodeSnapshot]
    ancestor_nodes: list[GraphNodeSnapshot]
    initial_candidate_summaries: list[CandidateSummary]
    rejected_signatures: list[str]
    promotion_subject: str
    canonical_protagonist: str
    continuity_rules: list[str]
    must_keep: list[str]
    must_avoid: list[str]
    current_blueprint: StoryBlueprint
    open_conflicts: list[str]
    event_timeline: list[str]


class GraphGapAnalysis(TypedDict):
    missing_categories: list[CreativeCategory]
    unresolved_conflict_ids: list[str]
    subject_drift_risks: list[str]
    product_integration_gaps: list[str]
    recommended_category: CreativeCategory
    summary: str


class GrowthPlan(TypedDict):
    growth_goal: str
    resolved_category: CreativeCategory
    allowed_relations: list[str]
    must_preserve: list[str]
    must_introduce: list[str]
    must_not_introduce: list[str]
    candidate_strategies: list[str]
    required_specialist: str


class ProposedRelation(TypedDict):
    from_ref: str
    to_ref: str
    relation: str
    rationale: str


class CandidateLineage(TypedDict):
    root_first_round_node_id: str
    parent_node_ids: list[str]
    growth_run_id: str
    generation_direction: GrowthDirection


class GrowthCandidate(TypedDict):
    candidate_id: str
    local_key: str
    growth_run_id: str
    seed_node_id: str
    seed_node_refs: list[str]
    direction: GrowthDirection
    category: CreativeCategory
    subtype: str
    title: str
    description: str
    actor_refs: list[str]
    product_feature_refs: list[str]
    proposed_relations: list[ProposedRelation]
    rationale: str
    story_effect: str
    risk_flags: list[str]
    lineage: CandidateLineage
    blueprint_patch: dict[str, Any]


class GrowthDraft(TypedDict):
    new_candidates: list[GrowthCandidate]


class GrowthConflict(TypedDict):
    conflict_type: Literal[
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
    ]
    severity: Literal["warning", "error"]
    candidate_key: str
    conflicting_ref: str
    message: str
    repair_instruction: str


class GrowthValidation(TypedDict):
    valid: bool
    conflicts: list[GrowthConflict]
    warnings: list[str]


class GrowthScores(TypedDict):
    anchor_alignment: float
    continuity: float
    graph_gain: float
    story_progress: float
    product_integration: float
    novelty: float
    relation_quality: float
    duplicate_risk: float


class GrowthRepairPlan(TypedDict):
    preserve_candidate_keys: list[str]
    rewrite_candidate_keys: list[str]
    instructions: list[str]


class GrowthCritique(TypedDict):
    passed: bool
    scores: GrowthScores
    issues: list[GrowthConflict]
    repair_plan: GrowthRepairPlan
    summary: str


class GrowthResult(TypedDict):
    status: WorkflowStatus
    selection_status: Literal["pending", "adopted", "rejected"]
    adopted_candidate_id: str
    adopted_node_id: str
    growth_run_id: str
    seed_node_id: str
    direction: GrowthDirection
    resolved_category: CreativeCategory
    candidates: list[GrowthCandidate]
    validation: GrowthValidation
    critique: GrowthCritique
    iteration_count: int
    base_graph_version: int


class GrowthState(TypedDict):
    request: GrowthRequest
    context: GrowthContext
    gap_analysis: GraphGapAnalysis
    plan: GrowthPlan
    draft: GrowthDraft
    validation: GrowthValidation
    critique: GrowthCritique
    repair_plan: GrowthRepairPlan
    result: GrowthResult
    repair_iteration: int
    max_repair_iterations: int


class RegisteredCandidate(TypedDict):
    candidate_id: str
    source_run_id: str
    source_kind: Literal["first_round", "growth"]
    local_key: str
    category: CreativeCategory
    title: str
    description: str
    payload: dict[str, Any]


class RegistryDecision(TypedDict):
    candidate_id: str
    status: CandidateDecisionStatus
    adopted_node_id: str
    decided_by: str
    decided_at: str
    rejection_reason: str


class CandidateRegistry(TypedDict):
    candidates: dict[str, RegisteredCandidate]
    decisions: dict[str, RegistryDecision]
    pending_ids: list[str]
    adopted_ids: list[str]
    rejected_ids: list[str]


StoryPhase = Literal[
    "hook",
    "setup",
    "development",
    "turning_point",
    "climax",
    "cta",
]
StoryStatus = Literal[
    "pending",
    "ready",
    "needs_more_nodes",
    "needs_review",
    "failed",
]


class StoryRequest(TypedDict):
    story_run_id: str
    base_graph_version: int
    title_instruction: str
    require_all_adopted_nodes: bool


class StoryContext(TypedDict):
    graph_version: int
    adopted_nodes: list[GraphNodeSnapshot]
    adopted_edges: list[GraphEdgeSnapshot]
    promotion_subject: str
    canonical_protagonist: str
    must_keep: list[str]
    must_avoid: list[str]
    selling_points: list[str]
    platform: str
    duration_seconds: int
    styles: list[str]
    first_round_blueprint: StoryBlueprint
    rejected_signatures: list[str]


class StoryReadinessIssue(TypedDict):
    code: str
    severity: Literal["warning", "error"]
    message: str
    node_ids: list[str]
    suggested_action: str


class StoryReadiness(TypedDict):
    ready: bool
    blocking_issues: list[StoryReadinessIssue]
    warnings: list[StoryReadinessIssue]
    orphan_node_ids: list[str]
    conflicting_node_ids: list[str]
    missing_story_functions: list[str]
    estimated_required_seconds: int
    available_seconds: int


class StoryBeat(TypedDict):
    beat_id: str
    phase: StoryPhase
    purpose: str
    estimated_seconds: int
    node_refs: list[str]
    relation_refs: list[str]
    product_feature_refs: list[str]
    planned_content: str


class StoryPlan(TypedDict):
    title: str
    logline: str
    theme: str
    beats: list[StoryBeat]
    required_node_ids: list[str]
    node_coverage: dict[str, list[str]]
    total_estimated_seconds: int


class StorySegment(TypedDict):
    segment_id: str
    phase: StoryPhase
    estimated_seconds: int
    node_refs: list[str]
    relation_refs: list[str]
    product_feature_refs: list[str]
    text: str


class StoryDraft(TypedDict):
    title: str
    logline: str
    synopsis: str
    segments: list[StorySegment]
    full_script: str
    cta: str
    used_node_ids: list[str]
    used_edge_ids: list[str]
    estimated_duration_seconds: int


class StoryValidationIssue(TypedDict):
    code: str
    severity: Literal["warning", "error"]
    message: str
    segment_id: str
    node_ids: list[str]
    repair_instruction: str


class StoryValidation(TypedDict):
    valid: bool
    issues: list[StoryValidationIssue]
    unused_adopted_node_ids: list[str]
    unknown_node_refs: list[str]
    forbidden_candidate_ids: list[str]


class StoryScores(TypedDict):
    adopted_node_coverage: float
    subject_consistency: float
    causal_coherence: float
    narrative_pacing: float
    product_integration: float
    style_alignment: float
    platform_fit: float
    constraint_satisfaction: float


class StoryRepairPlan(TypedDict):
    preserve_beat_ids: list[str]
    rewrite_beat_ids: list[str]
    missing_node_ids: list[str]
    remove_unapproved_facts: list[str]
    instructions: list[str]


class StoryCritique(TypedDict):
    passed: bool
    scores: StoryScores
    issues: list[StoryValidationIssue]
    repair_plan: StoryRepairPlan
    summary: str


class StoryResult(TypedDict):
    status: StoryStatus
    graph_version: int
    title: str
    logline: str
    synopsis: str
    full_script: str
    cta: str
    segments: list[StorySegment]
    used_node_ids: list[str]
    used_edge_ids: list[str]
    unused_adopted_node_ids: list[str]
    readiness: StoryReadiness
    validation: StoryValidation
    critique: StoryCritique
    iteration_count: int


class StoryState(TypedDict):
    request: StoryRequest
    context: StoryContext
    readiness: StoryReadiness
    plan: StoryPlan
    draft: StoryDraft
    validation: StoryValidation
    critique: StoryCritique
    repair_plan: StoryRepairPlan
    result: StoryResult
    repair_iteration: int
    max_repair_iterations: int


class SharedState(TypedDict):
    task_id: str
    input_text: str
    raw_brief: dict[str, Any]
    brief: NormalizedBrief
    messages: list[AgentMessage]
    plan: AnalysisPlan
    case_skill_context: CaseSkillContext
    analyses: CreativeAnalyses
    draft: CreativeDraft
    validation: ValidationResult
    critique: CritiqueResult
    repair_plan: RepairPlan
    final_result: FirstRoundResult
    first_round_selection: FirstRoundSelection
    graph_snapshot: GraphSnapshot
    growth: GrowthState
    candidate_registry: CandidateRegistry
    story: StoryState
    workflow_phase: Literal["initial_generation", "growth", "story_convergence"]
    current_stage: str
    iteration: int
    max_iterations: int
    errors: list[str]
    metadata: dict[str, Any]


STATE_FIELDS = frozenset(SharedState.__required_keys__)
GROWTH_FIELDS = frozenset(GrowthState.__required_keys__)
STORY_FIELDS = frozenset(StoryState.__required_keys__)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_brief() -> NormalizedBrief:
    return {
        "promotion_subject": "",
        "known_facts": [],
        "idea_fragments": [],
        "must_keep": [],
        "must_avoid": [],
        "audience": "",
        "platform": "",
        "duration_seconds": 0,
        "styles": [],
        "selling_points": [],
        "hot_memes": [],
    }


def empty_plan() -> AnalysisPlan:
    return {
        "intent": "",
        "required_facets": [],
        "context_plan": [],
        "risk_flags": [],
        "need_rag": False,
        "need_memory": False,
        "need_external_tool": False,
    }


def empty_case_skill_context(
    selection_mode: Literal["auto", "disabled"] = "auto",
) -> CaseSkillContext:
    return {
        "catalog_version": "creative-case-patterns-v1",
        "selection_mode": selection_mode,
        "selected": [],
    }


def empty_analyses() -> CreativeAnalyses:
    return {
        "subject": {
            "promotion_subject": "",
            "possible_protagonists": [],
            "continuity_rules": [],
            "subject_drift_risks": [],
        },
        "advertising": {
            "core_selling_points": [],
            "product_roles": [],
            "possible_insertions": [],
            "mandatory_messages": [],
            "advertising_risks": [],
        },
        "conflict": {
            "possible_goals": [],
            "possible_obstacles": [],
            "possible_stakes": [],
            "escalation_paths": [],
            "conflict_risks": [],
        },
        "narrative": {
            "recommended_structure": [],
            "required_story_functions": [],
            "possible_twists": [],
            "pacing_risks": [],
        },
    }


def empty_blueprint() -> StoryBlueprint:
    return {
        "logline": "",
        "theme": "",
        "protagonist": "",
        "protagonist_goal": "",
        "core_conflict": "",
        "stakes": "",
        "product_role": "",
        "hook": "",
        "development": "",
        "turning_point": "",
        "climax": "",
        "cta": "",
        "estimated_duration_seconds": 0,
    }


def empty_draft() -> CreativeDraft:
    return {
        "story_blueprint": empty_blueprint(),
        "candidates": [],
        "support_links": [],
    }


def empty_validation() -> ValidationResult:
    return {"valid": False, "errors": []}


def empty_scores() -> CriticScores:
    return {
        "brief_alignment": 0.0,
        "subject_consistency": 0.0,
        "story_coherence": 0.0,
        "product_integration": 0.0,
        "novelty": 0.0,
        "constraint_satisfaction": 0.0,
        "duplicate_risk": 0.0,
    }


def empty_repair_plan() -> RepairPlan:
    return {
        "preserve_candidate_keys": [],
        "rewrite_candidate_keys": [],
        "remove_candidate_keys": [],
        "story_fields_to_repair": [],
        "missing_requirements": [],
        "instructions": [],
    }


def empty_critique() -> CritiqueResult:
    return {
        "passed": False,
        "scores": empty_scores(),
        "global_issues": [],
        "candidate_issues": [],
        "repair_plan": empty_repair_plan(),
        "summary": "",
    }


def empty_final_result() -> FirstRoundResult:
    return {
        "status": "pending",
        "story_hypothesis": empty_blueprint(),
        "candidates": [],
        "support_links": [],
        "critique": empty_critique(),
        "iteration_count": 0,
    }


def empty_first_round_selection() -> FirstRoundSelection:
    return {
        "status": "not_ready",
        "decisions": {},
        "adopted_client_keys": [],
        "rejected_client_keys": [],
        "adopted_node_id_map": {},
    }


def empty_graph_node() -> GraphNodeSnapshot:
    return {
        "node_id": "",
        "source_client_key": "",
        "category": "creative_element",
        "subtype": "",
        "title": "",
        "description": "",
        "attributes": {},
        "actor_refs": [],
        "product_feature_refs": [],
    }


def empty_graph_snapshot() -> GraphSnapshot:
    return {"graph_version": 0, "nodes": [], "edges": []}


def empty_growth_request() -> GrowthRequest:
    return {
        "growth_run_id": "",
        "seed_node_id": "",
        "seed_node_version": 0,
        "direction": "deepen_current",
        "requested_category": None,
        "additional_requirements": "",
        "candidate_count": 3,
        "base_graph_version": 0,
        "first_round_run_id": "",
    }


def empty_growth_context() -> GrowthContext:
    return {
        "seed_node": empty_graph_node(),
        "adopted_nodes": [],
        "adopted_edges": [],
        "neighbor_nodes": [],
        "ancestor_nodes": [],
        "initial_candidate_summaries": [],
        "rejected_signatures": [],
        "promotion_subject": "",
        "canonical_protagonist": "",
        "continuity_rules": [],
        "must_keep": [],
        "must_avoid": [],
        "current_blueprint": empty_blueprint(),
        "open_conflicts": [],
        "event_timeline": [],
    }


def empty_gap_analysis() -> GraphGapAnalysis:
    return {
        "missing_categories": [],
        "unresolved_conflict_ids": [],
        "subject_drift_risks": [],
        "product_integration_gaps": [],
        "recommended_category": "story_event",
        "summary": "",
    }


def empty_growth_plan() -> GrowthPlan:
    return {
        "growth_goal": "",
        "resolved_category": "story_event",
        "allowed_relations": [],
        "must_preserve": [],
        "must_introduce": [],
        "must_not_introduce": [],
        "candidate_strategies": [],
        "required_specialist": "none",
    }


def empty_growth_validation() -> GrowthValidation:
    return {"valid": False, "conflicts": [], "warnings": []}


def empty_growth_scores() -> GrowthScores:
    return {
        "anchor_alignment": 0.0,
        "continuity": 0.0,
        "graph_gain": 0.0,
        "story_progress": 0.0,
        "product_integration": 0.0,
        "novelty": 0.0,
        "relation_quality": 0.0,
        "duplicate_risk": 0.0,
    }


def empty_growth_repair_plan() -> GrowthRepairPlan:
    return {
        "preserve_candidate_keys": [],
        "rewrite_candidate_keys": [],
        "instructions": [],
    }


def empty_growth_critique() -> GrowthCritique:
    return {
        "passed": False,
        "scores": empty_growth_scores(),
        "issues": [],
        "repair_plan": empty_growth_repair_plan(),
        "summary": "",
    }


def empty_growth_result() -> GrowthResult:
    return {
        "status": "pending",
        "selection_status": "pending",
        "adopted_candidate_id": "",
        "adopted_node_id": "",
        "growth_run_id": "",
        "seed_node_id": "",
        "direction": "deepen_current",
        "resolved_category": "story_event",
        "candidates": [],
        "validation": empty_growth_validation(),
        "critique": empty_growth_critique(),
        "iteration_count": 0,
        "base_graph_version": 0,
    }


def empty_growth_state() -> GrowthState:
    return {
        "request": empty_growth_request(),
        "context": empty_growth_context(),
        "gap_analysis": empty_gap_analysis(),
        "plan": empty_growth_plan(),
        "draft": {"new_candidates": []},
        "validation": empty_growth_validation(),
        "critique": empty_growth_critique(),
        "repair_plan": empty_growth_repair_plan(),
        "result": empty_growth_result(),
        "repair_iteration": 0,
        "max_repair_iterations": 1,
    }


def empty_candidate_registry() -> CandidateRegistry:
    return {
        "candidates": {},
        "decisions": {},
        "pending_ids": [],
        "adopted_ids": [],
        "rejected_ids": [],
    }


def empty_story_request() -> StoryRequest:
    return {
        "story_run_id": "",
        "base_graph_version": 0,
        "title_instruction": "",
        "require_all_adopted_nodes": True,
    }


def empty_story_context() -> StoryContext:
    return {
        "graph_version": 0,
        "adopted_nodes": [],
        "adopted_edges": [],
        "promotion_subject": "",
        "canonical_protagonist": "",
        "must_keep": [],
        "must_avoid": [],
        "selling_points": [],
        "platform": "",
        "duration_seconds": 0,
        "styles": [],
        "first_round_blueprint": empty_blueprint(),
        "rejected_signatures": [],
    }


def empty_story_readiness() -> StoryReadiness:
    return {
        "ready": False,
        "blocking_issues": [],
        "warnings": [],
        "orphan_node_ids": [],
        "conflicting_node_ids": [],
        "missing_story_functions": [],
        "estimated_required_seconds": 0,
        "available_seconds": 0,
    }


def empty_story_plan() -> StoryPlan:
    return {
        "title": "",
        "logline": "",
        "theme": "",
        "beats": [],
        "required_node_ids": [],
        "node_coverage": {},
        "total_estimated_seconds": 0,
    }


def empty_story_draft() -> StoryDraft:
    return {
        "title": "",
        "logline": "",
        "synopsis": "",
        "segments": [],
        "full_script": "",
        "cta": "",
        "used_node_ids": [],
        "used_edge_ids": [],
        "estimated_duration_seconds": 0,
    }


def empty_story_validation() -> StoryValidation:
    return {
        "valid": False,
        "issues": [],
        "unused_adopted_node_ids": [],
        "unknown_node_refs": [],
        "forbidden_candidate_ids": [],
    }


def empty_story_scores() -> StoryScores:
    return {
        "adopted_node_coverage": 0.0,
        "subject_consistency": 0.0,
        "causal_coherence": 0.0,
        "narrative_pacing": 0.0,
        "product_integration": 0.0,
        "style_alignment": 0.0,
        "platform_fit": 0.0,
        "constraint_satisfaction": 0.0,
    }


def empty_story_repair_plan() -> StoryRepairPlan:
    return {
        "preserve_beat_ids": [],
        "rewrite_beat_ids": [],
        "missing_node_ids": [],
        "remove_unapproved_facts": [],
        "instructions": [],
    }


def empty_story_critique() -> StoryCritique:
    return {
        "passed": False,
        "scores": empty_story_scores(),
        "issues": [],
        "repair_plan": empty_story_repair_plan(),
        "summary": "",
    }


def empty_story_result() -> StoryResult:
    return {
        "status": "pending",
        "graph_version": 0,
        "title": "",
        "logline": "",
        "synopsis": "",
        "full_script": "",
        "cta": "",
        "segments": [],
        "used_node_ids": [],
        "used_edge_ids": [],
        "unused_adopted_node_ids": [],
        "readiness": empty_story_readiness(),
        "validation": empty_story_validation(),
        "critique": empty_story_critique(),
        "iteration_count": 0,
    }


def empty_story_state() -> StoryState:
    return {
        "request": empty_story_request(),
        "context": empty_story_context(),
        "readiness": empty_story_readiness(),
        "plan": empty_story_plan(),
        "draft": empty_story_draft(),
        "validation": empty_story_validation(),
        "critique": empty_story_critique(),
        "repair_plan": empty_story_repair_plan(),
        "result": empty_story_result(),
        "repair_iteration": 0,
        "max_repair_iterations": 1,
    }


def create_initial_state(
    task_id: str,
    input_text: str,
    brief_input: Mapping[str, Any] | None = None,
    *,
    max_iterations: int = 2,
) -> SharedState:
    """Create a complete state before the graph starts.

    ``brief_input`` accepts the existing web form's camelCase fields as well as
    the Python workflow's snake_case fields. Normalization happens in the first
    deterministic graph node.
    """

    if not task_id.strip():
        raise ValueError("task_id must not be empty")
    if max_iterations < 0 or max_iterations > 5:
        raise ValueError("max_iterations must be between 0 and 5")

    raw_brief = deepcopy(dict(brief_input or {}))
    requested_skill_mode = str(
        raw_brief.get("caseSkillMode", raw_brief.get("case_skill_mode", "auto"))
    ).strip().lower()
    case_skill_mode: Literal["auto", "disabled"] = (
        "disabled" if requested_skill_mode == "disabled" else "auto"
    )

    state: SharedState = {
        "task_id": task_id.strip(),
        "input_text": input_text,
        "raw_brief": raw_brief,
        "brief": empty_brief(),
        "messages": [],
        "plan": empty_plan(),
        "case_skill_context": empty_case_skill_context(case_skill_mode),
        "analyses": empty_analyses(),
        "draft": empty_draft(),
        "validation": empty_validation(),
        "critique": empty_critique(),
        "repair_plan": empty_repair_plan(),
        "final_result": empty_final_result(),
        "first_round_selection": empty_first_round_selection(),
        "graph_snapshot": empty_graph_snapshot(),
        "growth": empty_growth_state(),
        "candidate_registry": empty_candidate_registry(),
        "story": empty_story_state(),
        "workflow_phase": "initial_generation",
        "current_stage": "initialized",
        "iteration": 0,
        "max_iterations": max_iterations,
        "errors": [],
        "metadata": {
            "state_version": "shared-state-v4-case-skills",
            "prompt_version": "first-round-v2-case-skills",
            "schema_version": "first-round-v2-case-skills",
            "model_calls": 0,
            "last_agent": "",
            "created_at": utc_now(),
            "updated_at": utc_now(),
        },
    }
    validate_complete_state(state)
    return state


def validate_complete_state(state: Mapping[str, Any]) -> None:
    actual = set(state)
    missing = STATE_FIELDS - actual
    unknown = actual - STATE_FIELDS
    if missing or unknown:
        raise KeyError(
            f"Invalid SharedState keys; missing={sorted(missing)}, "
            f"unknown={sorted(unknown)}"
        )


def rebuild_state(state: SharedState, **changes: Any) -> SharedState:
    """Return a fully reconstructed state without reusing mutable containers."""

    validate_complete_state(state)
    unknown_fields = set(changes) - STATE_FIELDS
    if unknown_fields:
        raise KeyError(f"Unknown SharedState fields: {sorted(unknown_fields)}")

    new_state: SharedState = {
        "task_id": state["task_id"],
        "input_text": state["input_text"],
        "raw_brief": deepcopy(state["raw_brief"]),
        "brief": deepcopy(state["brief"]),
        "messages": deepcopy(state["messages"]),
        "plan": deepcopy(state["plan"]),
        "case_skill_context": deepcopy(state["case_skill_context"]),
        "analyses": deepcopy(state["analyses"]),
        "draft": deepcopy(state["draft"]),
        "validation": deepcopy(state["validation"]),
        "critique": deepcopy(state["critique"]),
        "repair_plan": deepcopy(state["repair_plan"]),
        "final_result": deepcopy(state["final_result"]),
        "first_round_selection": deepcopy(state["first_round_selection"]),
        "graph_snapshot": deepcopy(state["graph_snapshot"]),
        "growth": deepcopy(state["growth"]),
        "candidate_registry": deepcopy(state["candidate_registry"]),
        "story": deepcopy(state["story"]),
        "workflow_phase": state["workflow_phase"],
        "current_stage": state["current_stage"],
        "iteration": state["iteration"],
        "max_iterations": state["max_iterations"],
        "errors": deepcopy(state["errors"]),
        "metadata": deepcopy(state["metadata"]),
    }

    target = cast(dict[str, Any], new_state)
    for field, value in changes.items():
        target[field] = deepcopy(value)

    validate_complete_state(new_state)
    return new_state


def rebuild_growth(growth: GrowthState, **changes: Any) -> GrowthState:
    """Return a complete, deeply copied nested growth section."""

    actual = set(growth)
    missing = GROWTH_FIELDS - actual
    unknown = actual - GROWTH_FIELDS
    if missing or unknown:
        raise KeyError(
            f"Invalid GrowthState keys; missing={sorted(missing)}, "
            f"unknown={sorted(unknown)}"
        )
    unknown_changes = set(changes) - GROWTH_FIELDS
    if unknown_changes:
        raise KeyError(f"Unknown GrowthState fields: {sorted(unknown_changes)}")
    new_growth: GrowthState = {
        "request": deepcopy(growth["request"]),
        "context": deepcopy(growth["context"]),
        "gap_analysis": deepcopy(growth["gap_analysis"]),
        "plan": deepcopy(growth["plan"]),
        "draft": deepcopy(growth["draft"]),
        "validation": deepcopy(growth["validation"]),
        "critique": deepcopy(growth["critique"]),
        "repair_plan": deepcopy(growth["repair_plan"]),
        "result": deepcopy(growth["result"]),
        "repair_iteration": growth["repair_iteration"],
        "max_repair_iterations": growth["max_repair_iterations"],
    }
    target = cast(dict[str, Any], new_growth)
    for field, value in changes.items():
        target[field] = deepcopy(value)
    return new_growth


def rebuild_story(story: StoryState, **changes: Any) -> StoryState:
    """Return a complete, deeply copied nested story section."""

    actual = set(story)
    missing = STORY_FIELDS - actual
    unknown = actual - STORY_FIELDS
    if missing or unknown:
        raise KeyError(
            f"Invalid StoryState keys; missing={sorted(missing)}, "
            f"unknown={sorted(unknown)}"
        )
    unknown_changes = set(changes) - STORY_FIELDS
    if unknown_changes:
        raise KeyError(f"Unknown StoryState fields: {sorted(unknown_changes)}")
    new_story: StoryState = {
        "request": deepcopy(story["request"]),
        "context": deepcopy(story["context"]),
        "readiness": deepcopy(story["readiness"]),
        "plan": deepcopy(story["plan"]),
        "draft": deepcopy(story["draft"]),
        "validation": deepcopy(story["validation"]),
        "critique": deepcopy(story["critique"]),
        "repair_plan": deepcopy(story["repair_plan"]),
        "result": deepcopy(story["result"]),
        "repair_iteration": story["repair_iteration"],
        "max_repair_iterations": story["max_repair_iterations"],
    }
    target = cast(dict[str, Any], new_story)
    for field, value in changes.items():
        target[field] = deepcopy(value)
    return new_story


def initialize_first_round_selection(
    candidates: list[CreativeCandidate],
) -> FirstRoundSelection:
    """Create pending decisions without mutating generated candidate payloads."""

    decisions: dict[str, CandidateDecision] = {
        candidate["client_key"]: {
            "client_key": candidate["client_key"],
            "status": "pending",
            "adopted_node_id": "",
            "decided_by": "",
            "decided_at": "",
            "rejection_reason": "",
        }
        for candidate in candidates
    }
    return {
        "status": "pending",
        "decisions": decisions,
        "adopted_client_keys": [],
        "rejected_client_keys": [],
        "adopted_node_id_map": {},
    }


def _registry_with_lists(
    candidates: Mapping[str, RegisteredCandidate],
    decisions: Mapping[str, RegistryDecision],
) -> CandidateRegistry:
    return {
        "candidates": deepcopy(dict(candidates)),
        "decisions": deepcopy(dict(decisions)),
        "pending_ids": sorted(
            candidate_id
            for candidate_id, decision in decisions.items()
            if decision["status"] == "pending"
        ),
        "adopted_ids": sorted(
            candidate_id
            for candidate_id, decision in decisions.items()
            if decision["status"] == "adopted"
        ),
        "rejected_ids": sorted(
            candidate_id
            for candidate_id, decision in decisions.items()
            if decision["status"] in {"rejected", "superseded"}
        ),
    }


def initialize_candidate_registry(
    candidates: list[CreativeCandidate],
    *,
    first_round_run_id: str,
) -> CandidateRegistry:
    records: dict[str, RegisteredCandidate] = {}
    decisions: dict[str, RegistryDecision] = {}
    for candidate in candidates:
        candidate_id = f"candidate:{first_round_run_id}:{candidate['client_key']}"
        records[candidate_id] = {
            "candidate_id": candidate_id,
            "source_run_id": first_round_run_id,
            "source_kind": "first_round",
            "local_key": candidate["client_key"],
            "category": candidate["category"],
            "title": candidate["title"],
            "description": candidate["description"],
            "payload": deepcopy(cast(dict[str, Any], candidate)),
        }
        decisions[candidate_id] = {
            "candidate_id": candidate_id,
            "status": "pending",
            "adopted_node_id": "",
            "decided_by": "",
            "decided_at": "",
            "rejection_reason": "",
        }
    return _registry_with_lists(records, decisions)


def register_growth_candidates(
    registry: CandidateRegistry,
    candidates: list[GrowthCandidate],
) -> CandidateRegistry:
    records = deepcopy(registry["candidates"])
    decisions = deepcopy(registry["decisions"])
    for candidate in candidates:
        candidate_id = candidate["candidate_id"]
        records[candidate_id] = {
            "candidate_id": candidate_id,
            "source_run_id": candidate["growth_run_id"],
            "source_kind": "growth",
            "local_key": candidate["local_key"],
            "category": candidate["category"],
            "title": candidate["title"],
            "description": candidate["description"],
            "payload": deepcopy(cast(dict[str, Any], candidate)),
        }
        existing = decisions.get(candidate_id)
        decisions[candidate_id] = deepcopy(existing) if existing else {
            "candidate_id": candidate_id,
            "status": "pending",
            "adopted_node_id": "",
            "decided_by": "",
            "decided_at": "",
            "rejection_reason": "",
        }
    return _registry_with_lists(records, decisions)


def apply_first_round_decisions(
    state: SharedState,
    *,
    adopted_client_keys: list[str],
    rejected_client_keys: list[str] | None = None,
    adopted_node_id_map: Mapping[str, str] | None = None,
    decided_by: str = "demo-user",
    graph_version: int = 1,
) -> SharedState:
    """Immutably materialize adopted first-round candidates into a graph snapshot.

    In production ``adopted_node_id_map`` should contain database-generated IDs.
    The qualified fallback IDs are for the local demo and cannot collide with
    model-generated ``local_key`` values.
    """

    validate_complete_state(state)
    if graph_version < 1:
        raise ValueError("graph_version must be at least 1")
    if state["final_result"]["status"] != "ready_for_selection":
        raise ValueError("first-round result must be ready_for_selection before adoption")
    candidates = state["final_result"]["candidates"]
    candidate_by_key = {candidate["client_key"]: candidate for candidate in candidates}
    known_keys = set(candidate_by_key)
    adopted = set(adopted_client_keys)
    rejected = set(rejected_client_keys or [])
    if adopted & rejected:
        raise ValueError("a candidate cannot be both adopted and rejected")
    unknown = (adopted | rejected) - known_keys
    if unknown:
        raise KeyError(f"Unknown first-round candidate keys: {sorted(unknown)}")
    if not adopted:
        raise ValueError("at least one candidate must be adopted before growth")

    supplied_ids = dict(adopted_node_id_map or {})
    unknown_mappings = set(supplied_ids) - adopted
    if unknown_mappings:
        raise KeyError(f"Node ID mappings are not adopted: {sorted(unknown_mappings)}")
    first_round_run_id = str(
        state["metadata"].get("first_round_run_id", state["task_id"])
    )
    node_ids = {
        key: supplied_ids.get(key, f"initial:{first_round_run_id}:{key}")
        for key in adopted
    }
    if len(set(node_ids.values())) != len(node_ids):
        raise ValueError("adopted node IDs must be unique")

    now = utc_now()
    decisions: dict[str, CandidateDecision] = {}
    for key in candidate_by_key:
        if key in adopted:
            status: CandidateDecisionStatus = "adopted"
        elif key in rejected:
            status = "rejected"
        else:
            status = "pending"
        decisions[key] = {
            "client_key": key,
            "status": status,
            "adopted_node_id": node_ids.get(key, ""),
            "decided_by": decided_by if status != "pending" else "",
            "decided_at": now if status != "pending" else "",
            "rejection_reason": "用户未采用" if status == "rejected" else "",
        }

    pending_count = sum(item["status"] == "pending" for item in decisions.values())
    selection_status: Literal["pending", "partial", "completed"]
    if pending_count == len(decisions):
        selection_status = "pending"
    elif pending_count:
        selection_status = "partial"
    else:
        selection_status = "completed"
    selection: FirstRoundSelection = {
        "status": selection_status,
        "decisions": decisions,
        "adopted_client_keys": sorted(adopted),
        "rejected_client_keys": sorted(rejected),
        "adopted_node_id_map": deepcopy(node_ids),
    }

    nodes: list[GraphNodeSnapshot] = []
    for key in sorted(adopted):
        candidate = candidate_by_key[key]
        nodes.append(
            {
                "node_id": node_ids[key],
                "source_client_key": key,
                "category": candidate["category"],
                "subtype": candidate["subtype"],
                "title": candidate["title"],
                "description": candidate["description"],
                "attributes": deepcopy(candidate["attributes"]),
                "actor_refs": [
                    node_ids[ref] for ref in candidate["actor_refs"] if ref in node_ids
                ],
                "product_feature_refs": deepcopy(candidate["product_feature_refs"]),
            }
        )

    edges: list[GraphEdgeSnapshot] = []
    for index, link in enumerate(state["final_result"]["support_links"], start=1):
        from_key = link["from_client_key"]
        to_key = link["to_client_key"]
        if from_key in adopted and to_key in adopted:
            edges.append(
                {
                    "edge_id": f"initial-edge:{first_round_run_id}:{index}",
                    "from_node_id": node_ids[from_key],
                    "to_node_id": node_ids[to_key],
                    "relation": link["relation"],
                    "rationale": link["rationale"],
                }
            )

    graph_snapshot: GraphSnapshot = {
        "graph_version": graph_version,
        "nodes": nodes,
        "edges": edges,
    }
    registry = (
        state["candidate_registry"]
        if state["candidate_registry"]["candidates"]
        else initialize_candidate_registry(
            candidates,
            first_round_run_id=first_round_run_id,
        )
    )
    registry_decisions = deepcopy(registry["decisions"])
    for candidate_id, record in registry["candidates"].items():
        if record["source_kind"] != "first_round":
            continue
        local_decision = decisions.get(record["local_key"])
        if local_decision is None:
            continue
        registry_decisions[candidate_id] = {
            "candidate_id": candidate_id,
            "status": local_decision["status"],
            "adopted_node_id": local_decision["adopted_node_id"],
            "decided_by": local_decision["decided_by"],
            "decided_at": local_decision["decided_at"],
            "rejection_reason": local_decision["rejection_reason"],
        }
    candidate_registry = _registry_with_lists(
        registry["candidates"],
        registry_decisions,
    )
    return rebuild_state(
        state,
        first_round_selection=selection,
        graph_snapshot=graph_snapshot,
        candidate_registry=candidate_registry,
        current_stage="first_round_selection_updated",
        metadata={
            **deepcopy(state["metadata"]),
            "first_round_run_id": first_round_run_id,
            "last_agent": "first_round_selection",
            "updated_at": now,
        },
    )


def create_growth_run_state(
    state: SharedState,
    *,
    growth_run_id: str,
    seed_node_id: str,
    direction: GrowthDirection,
    requested_category: CreativeCategory | None = None,
    additional_requirements: str = "",
    candidate_count: int = 3,
    max_repair_iterations: int = 1,
) -> SharedState:
    """Create one complete growth-run State while preserving first-round output."""

    validate_complete_state(state)
    if not growth_run_id.strip():
        raise ValueError("growth_run_id must not be empty")
    if not 1 <= candidate_count <= 5:
        raise ValueError("candidate_count must be between 1 and 5")
    if not 0 <= max_repair_iterations <= 3:
        raise ValueError("max_repair_iterations must be between 0 and 3")
    allowed_directions = {
        "deepen_current",
        "generate_followup_event",
        "add_obstacle",
        "add_character_or_prop",
        "generate_reversal",
        "create_parallel_plan",
    }
    if direction not in allowed_directions:
        raise ValueError(f"Unsupported growth direction: {direction}")
    if requested_category not in {
        None,
        "creative_element",
        "motivation_conflict",
        "story_event",
    }:
        raise ValueError(f"Unsupported requested category: {requested_category}")
    if not any(
        node["node_id"] == seed_node_id for node in state["graph_snapshot"]["nodes"]
    ):
        raise ValueError("seed_node_id must reference an adopted graph node")

    first_round_run_id = str(
        state["metadata"].get("first_round_run_id", state["task_id"])
    )
    growth = empty_growth_state()
    growth["request"] = {
        "growth_run_id": growth_run_id.strip(),
        "seed_node_id": seed_node_id,
        "seed_node_version": state["graph_snapshot"]["graph_version"],
        "direction": direction,
        "requested_category": requested_category,
        "additional_requirements": additional_requirements.strip(),
        "candidate_count": candidate_count,
        "base_graph_version": state["graph_snapshot"]["graph_version"],
        "first_round_run_id": first_round_run_id,
    }
    growth["max_repair_iterations"] = max_repair_iterations
    return rebuild_state(
        state,
        task_id=growth_run_id.strip(),
        input_text=additional_requirements.strip(),
        growth=growth,
        workflow_phase="growth",
        current_stage="growth_initialized",
        iteration=0,
        errors=[],
        messages=[],
        metadata={
            **deepcopy(state["metadata"]),
            "state_version": "shared-state-v3",
            "prompt_version": "growth-v1",
            "schema_version": "growth-v1",
            "parent_task_id": first_round_run_id,
            "first_round_run_id": first_round_run_id,
            "growth_run_id": growth_run_id.strip(),
            "model_calls": 0,
            "last_agent": "growth_initializer",
            "updated_at": utc_now(),
        },
    )


def adopt_growth_candidate(
    state: SharedState,
    *,
    candidate_id: str,
    expected_graph_version: int,
    adopted_node_id: str | None = None,
    decided_by: str = "demo-user",
) -> SharedState:
    """Immutably adopt one ready growth candidate and advance graph version.

    This is a local domain helper for the demo. A production application should
    perform the same validation and ID mapping inside a database transaction,
    then build the next ``GraphSnapshot`` from persisted adopted nodes.
    """

    validate_complete_state(state)
    growth = state["growth"]
    result = growth["result"]
    if result["status"] != "ready_for_selection":
        raise ValueError("only a ready_for_selection growth result can be adopted")
    if result["selection_status"] != "pending":
        raise ValueError("this growth run already has a decision")
    if expected_graph_version != state["graph_snapshot"]["graph_version"]:
        raise ValueError("graph version changed; refresh before adopting candidate")
    candidate = next(
        (item for item in result["candidates"] if item["candidate_id"] == candidate_id),
        None,
    )
    if candidate is None:
        raise KeyError(f"Unknown growth candidate_id: {candidate_id}")

    node_id = adopted_node_id or (
        f"node:{growth['request']['growth_run_id']}:{candidate['local_key']}"
    )
    existing_ids = {node["node_id"] for node in state["graph_snapshot"]["nodes"]}
    if node_id in existing_ids:
        raise ValueError("adopted_node_id already exists in graph snapshot")

    def resolve_ref(ref: str) -> str:
        if ref == candidate["local_key"]:
            return node_id
        if ref in existing_ids:
            return ref
        raise ValueError(
            f"candidate references an unadopted or unknown node: {ref}"
        )

    actor_refs = [resolve_ref(ref) for ref in candidate["actor_refs"]]
    node: GraphNodeSnapshot = {
        "node_id": node_id,
        "source_client_key": candidate["local_key"],
        "category": candidate["category"],
        "subtype": candidate["subtype"],
        "title": candidate["title"],
        "description": candidate["description"],
        "attributes": {
            "rationale": candidate["rationale"],
            "story_effect": candidate["story_effect"],
            "lineage": deepcopy(candidate["lineage"]),
            "blueprint_patch": deepcopy(candidate["blueprint_patch"]),
        },
        "actor_refs": actor_refs,
        "product_feature_refs": deepcopy(candidate["product_feature_refs"]),
    }

    new_edges: list[GraphEdgeSnapshot] = []
    for index, relation in enumerate(candidate["proposed_relations"], start=1):
        from_node_id = resolve_ref(relation["from_ref"])
        to_node_id = resolve_ref(relation["to_ref"])
        if from_node_id == to_node_id:
            raise ValueError("cannot adopt a self-referencing relation")
        new_edges.append(
            {
                "edge_id": (
                    f"growth-edge:{growth['request']['growth_run_id']}:"
                    f"{candidate['local_key']}:{index}"
                ),
                "from_node_id": from_node_id,
                "to_node_id": to_node_id,
                "relation": relation["relation"],
                "rationale": relation["rationale"],
            }
        )

    graph_snapshot: GraphSnapshot = {
        "graph_version": expected_graph_version + 1,
        "nodes": [*deepcopy(state["graph_snapshot"]["nodes"]), node],
        "edges": [*deepcopy(state["graph_snapshot"]["edges"]), *new_edges],
    }
    updated_result: GrowthResult = {
        **deepcopy(result),
        "selection_status": "adopted",
        "adopted_candidate_id": candidate_id,
        "adopted_node_id": node_id,
    }
    next_growth = rebuild_growth(growth, result=updated_result)
    registry = (
        state["candidate_registry"]
        if candidate_id in state["candidate_registry"]["candidates"]
        else register_growth_candidates(
            state["candidate_registry"],
            result["candidates"],
        )
    )
    registry_decisions = deepcopy(registry["decisions"])
    now = utc_now()
    for registered_id, record in registry["candidates"].items():
        if record["source_run_id"] != growth["request"]["growth_run_id"]:
            continue
        is_selected = registered_id == candidate_id
        registry_decisions[registered_id] = {
            "candidate_id": registered_id,
            "status": "adopted" if is_selected else "rejected",
            "adopted_node_id": node_id if is_selected else "",
            "decided_by": decided_by,
            "decided_at": now,
            "rejection_reason": "" if is_selected else "同批次未采用",
        }
    candidate_registry = _registry_with_lists(
        registry["candidates"],
        registry_decisions,
    )
    message: AgentMessage = {
        "role": "growth_selection",
        "node": "growth_selection",
        "content": f"已采用生长候选：{candidate['title']}",
        "iteration": growth["repair_iteration"],
    }
    return rebuild_state(
        state,
        graph_snapshot=graph_snapshot,
        growth=next_growth,
        candidate_registry=candidate_registry,
        current_stage="growth_candidate_adopted",
        messages=[*deepcopy(state["messages"]), message],
        metadata={
            **deepcopy(state["metadata"]),
            "last_agent": "growth_selection",
            "last_decided_by": decided_by,
            "updated_at": now,
        },
    )


def reject_growth_candidates(
    state: SharedState,
    *,
    expected_graph_version: int,
    decided_by: str = "demo-user",
    rejection_reason: str = "本批次均不采用",
) -> SharedState:
    """Reject every candidate in the current growth run without changing the graph.

    A growth batch is a single selection unit in the current demo: the user may
    adopt one candidate (which rejects its siblings) or reject the complete
    batch. Either action resolves every registry decision in that run so Story
    Convergence cannot accidentally consume unresolved candidates.
    """

    validate_complete_state(state)
    growth = state["growth"]
    result = growth["result"]
    if result["status"] != "ready_for_selection":
        raise ValueError("only a ready_for_selection growth result can be rejected")
    if result["selection_status"] != "pending":
        raise ValueError("this growth run already has a decision")
    if expected_graph_version != state["graph_snapshot"]["graph_version"]:
        raise ValueError("graph version changed; refresh before rejecting candidates")

    registry = state["candidate_registry"]
    if any(
        candidate["candidate_id"] not in registry["candidates"]
        for candidate in result["candidates"]
    ):
        registry = register_growth_candidates(registry, result["candidates"])
    registry_decisions = deepcopy(registry["decisions"])
    now = utc_now()
    run_id = growth["request"]["growth_run_id"]
    for candidate_id, record in registry["candidates"].items():
        if record["source_run_id"] != run_id:
            continue
        registry_decisions[candidate_id] = {
            "candidate_id": candidate_id,
            "status": "rejected",
            "adopted_node_id": "",
            "decided_by": decided_by,
            "decided_at": now,
            "rejection_reason": rejection_reason.strip() or "本批次均不采用",
        }
    candidate_registry = _registry_with_lists(
        registry["candidates"],
        registry_decisions,
    )
    updated_result: GrowthResult = {
        **deepcopy(result),
        "selection_status": "rejected",
        "adopted_candidate_id": "",
        "adopted_node_id": "",
    }
    next_growth = rebuild_growth(growth, result=updated_result)
    message: AgentMessage = {
        "role": "growth_selection",
        "node": "growth_selection",
        "content": f"已拒绝生长批次 {run_id} 的全部候选",
        "iteration": growth["repair_iteration"],
    }
    return rebuild_state(
        state,
        growth=next_growth,
        candidate_registry=candidate_registry,
        current_stage="growth_candidates_rejected",
        messages=[*deepcopy(state["messages"]), message],
        metadata={
            **deepcopy(state["metadata"]),
            "last_agent": "growth_selection",
            "last_decided_by": decided_by,
            "updated_at": now,
        },
    )


def create_story_run_state(
    state: SharedState,
    *,
    story_run_id: str,
    title_instruction: str = "",
    require_all_adopted_nodes: bool = True,
    max_repair_iterations: int = 1,
) -> SharedState:
    """Create one complete Story Convergence run from the current graph snapshot."""

    validate_complete_state(state)
    if not story_run_id.strip():
        raise ValueError("story_run_id must not be empty")
    if not 0 <= max_repair_iterations <= 3:
        raise ValueError("max_repair_iterations must be between 0 and 3")
    story = empty_story_state()
    story["request"] = {
        "story_run_id": story_run_id.strip(),
        "base_graph_version": state["graph_snapshot"]["graph_version"],
        "title_instruction": title_instruction.strip(),
        "require_all_adopted_nodes": require_all_adopted_nodes,
    }
    story["max_repair_iterations"] = max_repair_iterations
    parent_task_id = state["task_id"]
    return rebuild_state(
        state,
        task_id=story_run_id.strip(),
        input_text=title_instruction.strip(),
        story=story,
        workflow_phase="story_convergence",
        current_stage="story_initialized",
        iteration=0,
        errors=[],
        messages=[],
        metadata={
            **deepcopy(state["metadata"]),
            "state_version": "shared-state-v3",
            "prompt_version": "story-v1",
            "schema_version": "story-v1",
            "parent_task_id": parent_task_id,
            "story_run_id": story_run_id.strip(),
            "model_calls": 0,
            "last_agent": "story_initializer",
            "updated_at": utc_now(),
        },
    )
