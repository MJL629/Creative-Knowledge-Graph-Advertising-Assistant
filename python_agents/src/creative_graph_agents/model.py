"""OpenAI-compatible and deterministic mock JSON model adapters."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import json
import os
import time
from typing import Any, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _as_mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


class JsonModel(Protocol):
    """Dependency injected into graph nodes; never stored in SharedState."""

    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ModelConfig:
    api_key: str
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-chat"
    timeout_seconds: float = 60.0
    max_tokens: int = 4096
    retry_max: int = 2
    temperature: float = 0.7

    @classmethod
    def from_env(cls) -> "ModelConfig":
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if not api_key or api_key.startswith("replace_with"):
            raise ValueError("OPENAI_API_KEY is required for the real provider")
        return cls(
            api_key=api_key,
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com").rstrip("/"),
            model=os.getenv("OPENAI_MODEL", "deepseek-chat"),
            timeout_seconds=float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60")),
            max_tokens=int(os.getenv("OPENAI_MAX_TOKENS", "4096")),
            retry_max=max(0, min(int(os.getenv("OPENAI_RETRY_MAX", "2")), 5)),
            temperature=float(os.getenv("OPENAI_TEMPERATURE", "0.7")),
        )


class OpenAICompatibleJsonModel:
    """Minimal standard-library client for `/chat/completions` JSON output."""

    def __init__(self, config: ModelConfig | None = None) -> None:
        self.config = config or ModelConfig.from_env()

    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {"task": task, **deepcopy(dict(payload))},
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            },
        ]

        for attempt in range(self.config.retry_max + 1):
            if attempt:
                time.sleep(0.2 * (2 ** (attempt - 1)))
            try:
                return self._request(messages)
            except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
                last_error = error
                messages = [
                    *messages,
                    {
                        "role": "user",
                        "content": "上一次响应无法解析。请只重新输出符合既定结构的合法 JSON。",
                    },
                ]

        raise RuntimeError(f"Model JSON request failed after retries: {last_error}")

    def _request(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        body = json.dumps(
            {
                "model": self.config.model,
                "messages": messages,
                "response_format": {"type": "json_object"},
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
                "stream": False,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            f"{self.config.base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
        )
        with urlopen(request, timeout=self.config.timeout_seconds) as response:
            envelope = json.loads(response.read().decode("utf-8"))
        content = envelope.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Model returned empty content")
        cleaned = content.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.removeprefix("```json").removeprefix("```")
            cleaned = cleaned.removesuffix("```").strip()
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("Model JSON root must be an object")
        return parsed


class MockJsonModel:
    """Deterministic offline model used by examples and tests."""

    def __init__(
        self,
        *,
        force_first_critique_failure: bool = False,
        force_first_growth_critique_failure: bool = False,
        force_first_story_critique_failure: bool = False,
    ) -> None:
        self.force_first_critique_failure = force_first_critique_failure
        self.force_first_growth_critique_failure = force_first_growth_critique_failure
        self.force_first_story_critique_failure = force_first_story_critique_failure
        self.calls: list[str] = []
        self._critic_calls = 0
        self._growth_critic_calls = 0
        self._story_critic_calls = 0

    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        del system_prompt
        self.calls.append(task)
        handlers = {
            "supervisor_plan": self._supervisor,
            "select_case_skills": self._select_case_skills,
            "subject_analysis": self._subject,
            "advertising_analysis": self._advertising,
            "conflict_analysis": self._conflict,
            "narrative_analysis": self._narrative,
            "creative_initial": self._creative,
            "creative_repair": self._repair,
            "critic_review": self._critic,
            "growth_generate": self._growth_generate,
            "growth_repair": self._growth_repair,
            "growth_critic": self._growth_critic,
            "story_plan": self._story_plan,
            "story_write": self._story_write,
            "story_repair": self._story_repair,
            "story_critic": self._story_critic,
        }
        try:
            return handlers[task](payload)
        except KeyError as error:
            raise ValueError(f"Unsupported mock task: {task}") from error

    @staticmethod
    def _brief(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        brief = payload.get("brief", {})
        return brief if isinstance(brief, Mapping) else {}

    def _supervisor(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        return {
            "intent": "initial_divergence",
            "required_facets": ["subject", "advertising", "conflict", "narrative"],
            "context_plan": [
                "normalized_brief",
                "hard_constraints",
                "selling_points",
                "platform_and_duration",
            ],
            "risk_flags": [] if brief.get("selling_points") else ["selling_points_missing"],
            "need_rag": False,
            "need_memory": False,
            "need_external_tool": False,
        }

    def _select_case_skills(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief_text = json.dumps(
            deepcopy(dict(self._brief(payload))),
            ensure_ascii=False,
        ).lower()
        raw_catalog = payload.get("skill_catalog", [])
        catalog = raw_catalog if isinstance(raw_catalog, list) else []
        ranked: list[tuple[int, str, str]] = []
        for raw in catalog:
            if not isinstance(raw, Mapping):
                continue
            skill_id = str(raw.get("skill_id", "")).strip()
            if not skill_id:
                continue
            triggers = raw.get("triggers", [])
            trigger_values = triggers if isinstance(triggers, list) else []
            matched = [
                str(item)
                for item in trigger_values
                if str(item).strip() and str(item).lower() in brief_text
            ]
            if matched:
                ranked.append((len(matched), skill_id, "、".join(matched[:3])))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        return {
            "selected_skills": [
                {
                    "skill_id": skill_id,
                    "reason": f"Brief 命中模式线索：{matched}",
                }
                for _, skill_id, matched in ranked[:2]
            ]
        }

    def _subject(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        product = str(brief.get("promotion_subject", "推广对象"))
        return {
            "promotion_subject": product,
            "possible_protagonists": [
                {
                    "role": "主动挑战者",
                    "motivation": "在有限时间内完成公开目标",
                    "agency": "主动选择并执行挑战策略",
                    "relationship_to_product": f"通过{product}的核心玩法推动行动",
                },
                {
                    "role": "规则守护者",
                    "motivation": "维护当前规则与身份",
                    "agency": "设置阻碍并回应挑战",
                    "relationship_to_product": "将产品规则具象化为人物行为",
                },
            ],
            "continuity_rules": [
                f"所有冲突与事件必须持续围绕{product}",
                "事件必须保留主角的主动行动",
            ],
            "subject_drift_risks": ["通过更换主角制造新奇", "产品只在 CTA 中出现"],
        }

    def _advertising(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        product = str(brief.get("promotion_subject", "推广对象"))
        selling_points = [str(item) for item in brief.get("selling_points", [])]
        if not selling_points:
            selling_points = [f"{product}的核心体验"]
        return {
            "core_selling_points": selling_points,
            "product_roles": ["rule", "tool", "reward"],
            "possible_insertions": [
                {
                    "selling_point": selling_points[0],
                    "narrative_function": "成为挑战得以发生的核心规则",
                    "suitable_moment": "开场规则展示与高潮兑现",
                }
            ],
            "mandatory_messages": [f"观众能够理解{product}如何参与故事"],
            "advertising_risks": ["故事成立但产品可被任意替换"],
        }

    def _conflict(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        product = str(brief.get("promotion_subject", "推广对象"))
        return {
            "possible_goals": ["赢得限时挑战", "守住当前优势"],
            "possible_obstacles": ["公开倒计时", "对手升级规则"],
            "possible_stakes": ["失去象征性奖励", "在朋友面前接受反差惩罚"],
            "escalation_paths": [
                {
                    "start": "主角接受基础挑战",
                    "escalation": "规则突然升级并要求团队协作",
                    "consequence": f"必须使用{product}的核心机制完成反转",
                }
            ],
            "conflict_risks": ["只有热闹动作，没有明确目标和代价"],
        }

    def _narrative(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        duration = int(brief.get("duration_seconds", 30) or 30)
        return {
            "recommended_structure": [
                {"phase": "hook", "purpose": "立即展示规则和视觉奇观", "estimated_seconds": 3},
                {"phase": "development", "purpose": "目标、阻碍和产品玩法升级", "estimated_seconds": max(6, duration // 3)},
                {"phase": "turning_point", "purpose": "主角主动发现新的解决方式", "estimated_seconds": max(4, duration // 5)},
                {"phase": "climax", "purpose": "产品机制完成决定性动作", "estimated_seconds": max(4, duration // 5)},
                {"phase": "cta", "purpose": "邀请观众进入同一挑战", "estimated_seconds": 3},
            ],
            "required_story_functions": ["主体目标", "明确阻碍", "可见行动", "结果变化", "产品价值"],
            "possible_twists": ["被低估者利用规则反超", "奖励在最后一秒更换主人"],
            "pacing_risks": ["背景说明过长", "CTA 与剧情机制割裂"],
        }

    def _creative(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        brief = self._brief(payload)
        product = str(brief.get("promotion_subject", "推广对象"))
        ideas = [str(item) for item in brief.get("idea_fragments", [])]
        seed = ideas[0] if ideas else "一场公开挑战"
        selling_points = [str(item) for item in brief.get("selling_points", [])]
        feature = selling_points[0] if selling_points else product
        duration = int(brief.get("duration_seconds", 30) or 30)
        return {
            "story_blueprint": {
                "logline": f"一名被低估的挑战者借助{product}的规则，在倒计时结束前完成反转。",
                "theme": "人人都能主动进入并改变游戏规则",
                "protagonist": "被低估的主动挑战者",
                "protagonist_goal": "在倒计时结束前赢得公开挑战",
                "core_conflict": "规则守护者不断升级阻碍",
                "stakes": "失败者失去象征性奖励并接受反差惩罚",
                "product_role": f"{feature}既是行动工具，也是决定胜负的规则",
                "hook": seed,
                "development": "挑战公开开始，对手利用规则压制主角",
                "turning_point": "主角发现隐藏的团队协作机制",
                "climax": "最后三秒完成决定性动作并反超",
                "cta": f"进入{product}，下一位挑战者就是你",
                "estimated_duration_seconds": duration,
            },
            "candidates": [
                {
                    "client_key": "element_1",
                    "category": "creative_element",
                    "subtype": "character",
                    "title": "规则守护者",
                    "description": f"把{product}规则具象化、不断升级挑战的人物。",
                    "attributes": {"story_function": "对手与规则说明者"},
                    "rationale": "把抽象玩法转化为可见人物行动",
                    "actor_refs": [],
                    "product_feature_refs": [feature],
                },
                {
                    "client_key": "element_2",
                    "category": "creative_element",
                    "subtype": "prop",
                    "title": "倒计时奖励装置",
                    "description": "随挑战进度变化、在最后一秒更换归属的视觉装置。",
                    "attributes": {"story_function": "目标与胜负可视化"},
                    "rationale": "让目标、风险和结果在短视频中一眼可见",
                    "actor_refs": [],
                    "product_feature_refs": [feature],
                },
                {
                    "client_key": "conflict_1",
                    "category": "motivation_conflict",
                    "subtype": "competition",
                    "title": "限时公开挑战",
                    "description": "主角必须在倒计时内突破守护者持续升级的规则。",
                    "attributes": {"goal": "赢得挑战", "obstacle": "升级规则", "stakes": "失去奖励"},
                    "rationale": "形成目标、阻碍与失败代价",
                    "actor_refs": ["element_1"],
                    "product_feature_refs": [feature],
                },
                {
                    "client_key": "conflict_2",
                    "category": "motivation_conflict",
                    "subtype": "identity_conflict",
                    "title": "被低估者的选择",
                    "description": "主角必须在独自逞强和主动邀请队友之间作出选择。",
                    "attributes": {"goal": "证明自己", "obstacle": "错误策略", "stakes": "团队失败"},
                    "rationale": "给动作场面增加人物动机",
                    "actor_refs": ["element_1"],
                    "product_feature_refs": [feature],
                },
                {
                    "client_key": "event_1",
                    "category": "story_event",
                    "subtype": "inciting_incident",
                    "title": "规则突然启动",
                    "description": "奖励装置亮起，全场倒计时，守护者宣布挑战开始。",
                    "attributes": {"trigger": "装置亮起", "action": "宣布挑战", "result": "所有人进入规则"},
                    "rationale": "用动作代替背景说明",
                    "actor_refs": ["element_1"],
                    "product_feature_refs": [feature],
                },
                {
                    "client_key": "event_2",
                    "category": "story_event",
                    "subtype": "climax",
                    "title": "最后三秒反超",
                    "description": f"主角利用{feature}完成团队配合，奖励装置在最后一秒换主。",
                    "attributes": {"trigger": "最后三秒", "action": "团队配合", "result": "完成反超"},
                    "rationale": "让产品机制直接决定高潮结果",
                    "actor_refs": ["element_1"],
                    "product_feature_refs": [feature],
                },
            ],
            "support_links": [
                {"from_client_key": "element_2", "to_client_key": "conflict_1", "relation": "visualizes", "rationale": "装置显示挑战目标和代价"},
                {"from_client_key": "conflict_1", "to_client_key": "event_1", "relation": "triggers", "rationale": "公开挑战触发规则启动"},
                {"from_client_key": "conflict_2", "to_client_key": "event_2", "relation": "resolves", "rationale": "人物选择推动团队反超"},
            ],
        }

    def _repair(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        previous = payload.get("previous_draft", {})
        draft = deepcopy(dict(previous)) if isinstance(previous, Mapping) else {}
        repair_plan = payload.get("repair_plan", {})
        plan = repair_plan if isinstance(repair_plan, Mapping) else {}
        rewrite_keys = {str(item) for item in plan.get("rewrite_candidate_keys", [])}
        candidates = draft.get("candidates", [])
        if isinstance(candidates, list):
            repaired: list[dict[str, Any]] = []
            for item in candidates:
                candidate = deepcopy(dict(item)) if isinstance(item, Mapping) else {}
                if str(candidate.get("client_key")) in rewrite_keys:
                    candidate["description"] = f"{candidate.get('description', '')} 修复后明确保留主体目标与产品价值。"
                    candidate["rationale"] = "根据 Critic 指令进行局部修复"
                repaired.append(candidate)
            draft["candidates"] = repaired
        blueprint = draft.get("story_blueprint", {})
        if isinstance(blueprint, Mapping):
            updated_blueprint = deepcopy(dict(blueprint))
            updated_blueprint["product_role"] = f"{updated_blueprint.get('product_role', '')}，且在高潮中产生不可替代的因果作用"
            draft["story_blueprint"] = updated_blueprint
        return draft

    def _critic(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._critic_calls += 1
        should_fail = self.force_first_critique_failure and self._critic_calls == 1
        draft = payload.get("draft", {})
        candidates = draft.get("candidates", []) if isinstance(draft, Mapping) else []
        keys = [str(item.get("client_key")) for item in candidates if isinstance(item, Mapping)]
        if should_fail:
            target = "event_2" if "event_2" in keys else (keys[-1] if keys else "")
            return {
                "passed": False,
                "scores": {
                    "brief_alignment": 0.85,
                    "subject_consistency": 0.62,
                    "story_coherence": 0.72,
                    "product_integration": 0.55,
                    "novelty": 0.78,
                    "constraint_satisfaction": 0.9,
                    "duplicate_risk": 0.15,
                },
                "global_issues": [],
                "candidate_issues": [
                    {
                        "scope": "candidate",
                        "target_key": target,
                        "dimension": "product_integration",
                        "severity": "error",
                        "message": "高潮中的产品因果作用还不够明确",
                        "repair_instruction": "保留人物和事件，只强化产品机制如何决定结果",
                    }
                ],
                "repair_plan": {
                    "preserve_candidate_keys": [key for key in keys if key != target],
                    "rewrite_candidate_keys": [target] if target else [],
                    "remove_candidate_keys": [],
                    "story_fields_to_repair": ["product_role"],
                    "missing_requirements": ["产品机制决定高潮结果"],
                    "instructions": ["只修复高潮候选和 product_role"],
                },
                "summary": "需要一次局部修复",
            }
        return {
            "passed": True,
            "scores": {
                "brief_alignment": 0.9,
                "subject_consistency": 0.9,
                "story_coherence": 0.88,
                "product_integration": 0.86,
                "novelty": 0.82,
                "constraint_satisfaction": 0.95,
                "duplicate_risk": 0.12,
            },
            "global_issues": [],
            "candidate_issues": [],
            "repair_plan": {
                "preserve_candidate_keys": keys,
                "rewrite_candidate_keys": [],
                "remove_candidate_keys": [],
                "story_fields_to_repair": [],
                "missing_requirements": [],
                "instructions": [],
            },
            "summary": "Story Blueprint 与三类候选通过统一审查",
        }

    def _growth_generate(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        request = _as_mapping(payload.get("request"))
        seed = _as_mapping(payload.get("seed_node"))
        plan = _as_mapping(payload.get("growth_plan"))
        constraints = _as_mapping(payload.get("hard_constraints"))
        direction = str(request.get("direction", "deepen_current"))
        category = str(plan.get("resolved_category", "story_event"))
        candidate_count = int(payload.get("candidate_count", 3) or 3)
        seed_id = str(seed.get("node_id", "seed"))
        seed_title = str(seed.get("title", "当前节点"))
        selling_points = [str(item) for item in constraints.get("selling_points", [])]
        feature = selling_points[0] if selling_points else str(
            constraints.get("promotion_subject", "产品核心玩法")
        )
        relation_options = [str(item) for item in plan.get("allowed_relations", [])]
        relation = relation_options[0] if relation_options else "elaborates"

        titles = {
            "creative_element": ["协作充能环", "潮汐提示旗", "反差奖励球", "透明规则牌", "水花计分冠"],
            "motivation_conflict": ["队友同步限制", "水量倒计时", "错位指令考验", "奖励归属争议", "临场换位规则"],
            "story_event": ["全队同步充能", "水幕路线翻转", "最后一枪接力", "奖励突然换主", "隐藏通道开启"],
        }.get(category, ["新生长节点一", "新生长节点二", "新生长节点三"])
        subtype = {
            "creative_element": "prop",
            "motivation_conflict": "rule_obstacle",
            "story_event": "follow_up",
        }.get(category, "growth")
        strategies = [
            "coherent_continuation",
            "surprising_reversal",
            "product_amplification",
            "visual_payoff",
            "character_choice",
        ]
        candidates: list[dict[str, Any]] = []
        for index in range(candidate_count):
            local_key = f"gr_{index + 1}"
            title = titles[index % len(titles)]
            description = (
                f"由“{seed_title}”生长：主体通过{feature}完成{title}，"
                f"形成符合 {direction} 的新变化。"
            )
            candidates.append(
                {
                    "local_key": local_key,
                    "category": category,
                    "subtype": subtype,
                    "title": title,
                    "description": description,
                    "seed_node_refs": [seed_id],
                    "actor_refs": [] if category == "creative_element" else [seed_id],
                    "product_feature_refs": [feature],
                    "proposed_relations": [
                        {
                            "from_ref": seed_id,
                            "to_ref": local_key,
                            "relation": relation,
                            "rationale": f"{title}由种子节点直接生长并产生新图谱信息",
                        }
                    ],
                    "story_effect": f"以{strategies[index]}推动主体下一步行动",
                    "rationale": f"保持推广主体并执行 {direction} 方向",
                    "risk_flags": [],
                    "blueprint_patch": (
                        {"turning_point": description}
                        if direction == "generate_reversal"
                        else {}
                    ),
                }
            )
        return {"resolved_category": category, "candidates": candidates}

    def _growth_repair(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        request = _as_mapping(payload.get("request"))
        plan = _as_mapping(payload.get("growth_plan"))
        previous = _as_mapping(payload.get("previous_draft"))
        repair_plan = _as_mapping(payload.get("repair_plan"))
        rewrite_keys = {str(item) for item in repair_plan.get("rewrite_candidate_keys", [])}
        seed_id = str(request.get("seed_node_id", "seed"))
        category = str(plan.get("resolved_category", "story_event"))
        relations = [str(item) for item in plan.get("allowed_relations", [])]
        relation = relations[0] if relations else "elaborates"
        candidates: list[dict[str, Any]] = []
        for item in previous.get("new_candidates", []):
            candidate = deepcopy(dict(item)) if isinstance(item, Mapping) else {}
            key = str(candidate.get("local_key", ""))
            if key in rewrite_keys:
                candidate["description"] = (
                    f"{candidate.get('description', '')} 修复后明确保持主体、因果和产品作用。"
                )
                candidate["rationale"] = "根据 Growth Critic 指令完成局部修复"
            candidate["category"] = category
            candidate["seed_node_refs"] = [seed_id]
            if category != "creative_element" and not candidate.get("actor_refs"):
                candidate["actor_refs"] = [seed_id]
            candidate["proposed_relations"] = [
                {
                    "from_ref": seed_id,
                    "to_ref": key,
                    "relation": relation,
                    "rationale": "修复后保持与种子节点的直接关系",
                }
            ]
            candidates.append(candidate)
        return {"resolved_category": category, "candidates": candidates}

    def _growth_critic(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._growth_critic_calls += 1
        draft = _as_mapping(payload.get("draft"))
        candidates = [
            _as_mapping(item) for item in draft.get("new_candidates", [])
        ]
        keys = [str(item.get("local_key", "")) for item in candidates]
        should_fail = (
            self.force_first_growth_critique_failure
            and self._growth_critic_calls == 1
        )
        if should_fail:
            target = keys[-1] if keys else ""
            return {
                "passed": False,
                "scores": {
                    "anchor_alignment": 0.88,
                    "continuity": 0.82,
                    "graph_gain": 0.58,
                    "story_progress": 0.72,
                    "product_integration": 0.8,
                    "novelty": 0.55,
                    "relation_quality": 0.86,
                    "duplicate_risk": 0.35,
                },
                "issues": [
                    {
                        "conflict_type": "semantic_duplicate",
                        "severity": "error",
                        "candidate_key": target,
                        "conflicting_ref": "",
                        "message": "该候选的图谱增量和新颖度不足",
                        "repair_instruction": "保留主体和关系，改用不同的事件机制",
                    }
                ],
                "repair_plan": {
                    "preserve_candidate_keys": [key for key in keys if key != target],
                    "rewrite_candidate_keys": [target] if target else [],
                    "instructions": ["只修复指定候选，不改写其他候选"],
                },
                "summary": "需要一次局部生长修复",
            }
        return {
            "passed": True,
            "scores": {
                "anchor_alignment": 0.93,
                "continuity": 0.9,
                "graph_gain": 0.87,
                "story_progress": 0.86,
                "product_integration": 0.88,
                "novelty": 0.84,
                "relation_quality": 0.91,
                "duplicate_risk": 0.1,
            },
            "issues": [],
            "repair_plan": {
                "preserve_candidate_keys": keys,
                "rewrite_candidate_keys": [],
                "instructions": [],
            },
            "summary": "生长候选保持主体并提供有效图谱增量",
        }

    def _story_plan(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        request = _as_mapping(payload.get("request"))
        context = _as_mapping(payload.get("context"))
        nodes = [_as_mapping(item) for item in context.get("adopted_nodes", [])]
        edges = [_as_mapping(item) for item in context.get("adopted_edges", [])]
        duration = int(context.get("duration_seconds", 30) or 30)
        product = str(context.get("promotion_subject", "推广对象"))
        title_instruction = str(request.get("title_instruction", "")).strip()
        title = title_instruction or f"{product}限时反转挑战"
        phases = ["hook", "setup", "development", "turning_point", "climax"]
        beat_count = max(1, len(nodes)) + 1
        base_seconds = duration // beat_count
        remainder = duration % beat_count
        beats: list[dict[str, Any]] = []
        coverage: dict[str, list[str]] = {}
        all_edge_ids = [str(edge.get("edge_id", "")) for edge in edges if edge.get("edge_id")]
        selling_points = [str(item) for item in context.get("selling_points", [])]
        fallback_feature = selling_points[0] if selling_points else product

        for index, node in enumerate(nodes):
            beat_id = f"beat_{index + 1}"
            node_id = str(node.get("node_id", ""))
            incident_edges = [
                str(edge.get("edge_id", ""))
                for edge in edges
                if node_id in {
                    str(edge.get("from_node_id", "")),
                    str(edge.get("to_node_id", "")),
                }
                and edge.get("edge_id")
            ]
            features = [str(item) for item in node.get("product_feature_refs", [])]
            if not features:
                features = [fallback_feature]
            seconds = base_seconds + (1 if index < remainder else 0)
            beats.append(
                {
                    "beat_id": beat_id,
                    "phase": phases[min(index, len(phases) - 1)],
                    "purpose": f"让已采用节点“{node.get('title', '')}”承担明确叙事功能",
                    "estimated_seconds": seconds,
                    "node_refs": [node_id],
                    "relation_refs": incident_edges,
                    "product_feature_refs": features,
                    "planned_content": f"主体通过{node.get('title', '')}推动局面发生变化",
                }
            )
            coverage[node_id] = [beat_id]

        cta_seconds = base_seconds + (1 if len(nodes) < remainder else 0)
        cta_node_refs = [str(nodes[-1].get("node_id", ""))] if nodes else []
        beats.append(
            {
                "beat_id": f"beat_{len(nodes) + 1}",
                "phase": "cta",
                "purpose": "把剧情结果自然转化为产品行动邀请",
                "estimated_seconds": cta_seconds,
                "node_refs": cta_node_refs,
                "relation_refs": all_edge_ids[-1:] if all_edge_ids else [],
                "product_feature_refs": [fallback_feature],
                "planned_content": f"邀请观众进入{product}完成同一挑战",
            }
        )
        if cta_node_refs:
            coverage.setdefault(cta_node_refs[0], []).append(f"beat_{len(nodes) + 1}")
        return {
            "title": title,
            "logline": f"既定主体利用已采用节点，在{duration}秒内完成一次产品驱动的反转。",
            "theme": "用户选择的创意节点共同决定故事走向",
            "beats": beats,
            "required_node_ids": [str(node.get("node_id", "")) for node in nodes],
            "node_coverage": coverage,
            "total_estimated_seconds": sum(beat["estimated_seconds"] for beat in beats),
        }

    def _story_write(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        context = _as_mapping(payload.get("context"))
        plan = _as_mapping(payload.get("story_plan"))
        nodes = {
            str(node.get("node_id", "")): node
            for node in (_as_mapping(item) for item in context.get("adopted_nodes", []))
        }
        segments: list[dict[str, Any]] = []
        used_nodes: list[str] = []
        used_edges: list[str] = []
        texts: list[str] = []
        for item in plan.get("beats", []):
            beat = _as_mapping(item)
            node_refs = [str(ref) for ref in beat.get("node_refs", [])]
            relation_refs = [str(ref) for ref in beat.get("relation_refs", [])]
            titles = [str(nodes[ref].get("title", "")) for ref in node_refs if ref in nodes]
            planned = str(beat.get("planned_content", ""))
            text = planned or f"{'、'.join(titles)}推动故事进入下一阶段。"
            segment = {
                "segment_id": str(beat.get("beat_id", "")),
                "phase": str(beat.get("phase", "development")),
                "estimated_seconds": int(beat.get("estimated_seconds", 0) or 0),
                "node_refs": node_refs,
                "relation_refs": relation_refs,
                "product_feature_refs": [
                    str(ref) for ref in beat.get("product_feature_refs", [])
                ],
                "text": text,
            }
            segments.append(segment)
            texts.append(text)
            for ref in node_refs:
                if ref not in used_nodes:
                    used_nodes.append(ref)
            for ref in relation_refs:
                if ref not in used_edges:
                    used_edges.append(ref)
        product = str(context.get("promotion_subject", "产品"))
        cta = f"现在进入{product}，亲自完成这场挑战。"
        return {
            "title": str(plan.get("title", "")),
            "logline": str(plan.get("logline", "")),
            "synopsis": "；".join(texts),
            "segments": segments,
            "full_script": "。".join(texts),
            "cta": cta,
            "used_node_ids": used_nodes,
            "used_edge_ids": used_edges,
            "estimated_duration_seconds": sum(
                int(segment["estimated_seconds"]) for segment in segments
            ),
        }

    def _story_repair(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        previous = _as_mapping(payload.get("previous_draft"))
        plan = _as_mapping(payload.get("story_plan"))
        repair_plan = _as_mapping(payload.get("repair_plan"))
        rewrite_ids = {str(item) for item in repair_plan.get("rewrite_beat_ids", [])}
        missing_nodes = [str(item) for item in repair_plan.get("missing_node_ids", [])]
        draft = deepcopy(dict(previous))
        segments: list[dict[str, Any]] = []
        for item in previous.get("segments", []):
            segment = deepcopy(dict(item)) if isinstance(item, Mapping) else {}
            segment_id = str(segment.get("segment_id", ""))
            if segment_id in rewrite_ids:
                segment["text"] = (
                    f"{segment.get('text', '')} 修复后明确保持 adopted 节点、主体和产品因果。"
                )
                refs = [str(ref) for ref in segment.get("node_refs", [])]
                for node_id in missing_nodes:
                    if node_id not in refs:
                        refs.append(node_id)
                segment["node_refs"] = refs
            segments.append(segment)
        if missing_nodes and segments and not rewrite_ids:
            refs = [str(ref) for ref in segments[0].get("node_refs", [])]
            for node_id in missing_nodes:
                if node_id not in refs:
                    refs.append(node_id)
            segments[0]["node_refs"] = refs
        used_nodes: list[str] = []
        used_edges: list[str] = []
        for segment in segments:
            for ref in segment.get("node_refs", []):
                if str(ref) not in used_nodes:
                    used_nodes.append(str(ref))
            for ref in segment.get("relation_refs", []):
                if str(ref) not in used_edges:
                    used_edges.append(str(ref))
        draft["segments"] = segments
        draft["used_node_ids"] = used_nodes
        draft["used_edge_ids"] = used_edges
        draft["full_script"] = "。".join(str(item.get("text", "")) for item in segments)
        draft["estimated_duration_seconds"] = int(
            plan.get("total_estimated_seconds", draft.get("estimated_duration_seconds", 0))
            or 0
        )
        return draft

    def _story_critic(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._story_critic_calls += 1
        plan = _as_mapping(payload.get("story_plan"))
        beat_ids = [
            str(_as_mapping(item).get("beat_id", "")) for item in plan.get("beats", [])
        ]
        should_fail = (
            self.force_first_story_critique_failure
            and self._story_critic_calls == 1
        )
        if should_fail:
            target = beat_ids[-2] if len(beat_ids) > 1 else (beat_ids[-1] if beat_ids else "")
            return {
                "passed": False,
                "scores": {
                    "adopted_node_coverage": 1.0,
                    "subject_consistency": 0.9,
                    "causal_coherence": 0.62,
                    "narrative_pacing": 0.68,
                    "product_integration": 0.82,
                    "style_alignment": 0.84,
                    "platform_fit": 0.8,
                    "constraint_satisfaction": 0.95,
                },
                "issues": [
                    {
                        "code": "weak_causal_transition",
                        "severity": "error",
                        "message": "高潮前的因果转折还不够明确",
                        "segment_id": target,
                        "node_ids": [],
                        "repair_instruction": "只强化该 Beat 的行动与结果关系",
                    }
                ],
                "repair_plan": {
                    "preserve_beat_ids": [beat_id for beat_id in beat_ids if beat_id != target],
                    "rewrite_beat_ids": [target] if target else [],
                    "missing_node_ids": [],
                    "remove_unapproved_facts": [],
                    "instructions": ["仅修复指定 Beat 的因果衔接"],
                },
                "summary": "需要一次 Beat 级局部修复",
            }
        return {
            "passed": True,
            "scores": {
                "adopted_node_coverage": 1.0,
                "subject_consistency": 0.93,
                "causal_coherence": 0.9,
                "narrative_pacing": 0.88,
                "product_integration": 0.9,
                "style_alignment": 0.87,
                "platform_fit": 0.9,
                "constraint_satisfaction": 0.96,
            },
            "issues": [],
            "repair_plan": {
                "preserve_beat_ids": beat_ids,
                "rewrite_beat_ids": [],
                "missing_node_ids": [],
                "remove_unapproved_facts": [],
                "instructions": [],
            },
            "summary": "Story 使用全部 adopted 节点并通过统一审查",
        }


def build_model_from_env() -> JsonModel:
    provider = os.getenv("CREATIVE_MODEL_PROVIDER", "mock").strip().lower()
    if provider == "mock":
        return MockJsonModel()
    if provider in {"deepseek", "openai", "openai-compatible"}:
        return OpenAICompatibleJsonModel()
    raise ValueError(f"Unsupported CREATIVE_MODEL_PROVIDER: {provider}")
