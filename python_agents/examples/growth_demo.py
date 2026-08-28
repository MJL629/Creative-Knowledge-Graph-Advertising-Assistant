"""Run first-round generation, adopt seeds, then execute one growth round."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, cast

from creative_graph_agents import (
    SharedState,
    apply_first_round_decisions,
    build_first_round_graph,
    build_growth_graph,
    create_growth_run_state,
    create_initial_state,
)
from creative_graph_agents.model import build_model_from_env


DIRECTIONS = (
    "deepen_current",
    "generate_followup_event",
    "add_obstacle",
    "add_character_or_prop",
    "generate_reversal",
    "create_parallel_plan",
)
CATEGORIES = ("auto", "creative_element", "motivation_conflict", "story_event")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Run one controlled graph growth round")
    parser.add_argument(
        "--brief",
        type=Path,
        default=Path(__file__).with_name("brief.json"),
    )
    parser.add_argument("--direction", choices=DIRECTIONS, default="generate_followup_event")
    parser.add_argument("--category", choices=CATEGORIES, default="story_event")
    parser.add_argument("--seed-key", default="element_1")
    parser.add_argument(
        "--requirements",
        default="保持轻松荒诞，不增加新主角",
    )
    parser.add_argument("--full-state", action="store_true")
    args = parser.parse_args()

    brief = cast(dict[str, Any], json.loads(args.brief.read_text(encoding="utf-8")))
    first_round_id = "growth-demo-first-round"
    first_round = cast(
        SharedState,
        build_first_round_graph(build_model_from_env()).invoke(
            create_initial_state(
                first_round_id,
                json.dumps(brief, ensure_ascii=False),
                brief,
            )
        ),
    )
    adopted_keys = sorted({args.seed_key, "conflict_1", "event_1"})
    selected = apply_first_round_decisions(
        first_round,
        adopted_client_keys=adopted_keys,
        graph_version=1,
    )
    seed_node_id = selected["first_round_selection"]["adopted_node_id_map"][
        args.seed_key
    ]
    category = None if args.category == "auto" else args.category
    growth_initial = create_growth_run_state(
        selected,
        growth_run_id="growth-demo-001",
        seed_node_id=seed_node_id,
        direction=args.direction,
        requested_category=category,
        additional_requirements=args.requirements,
    )
    result = cast(
        SharedState,
        build_growth_graph(build_model_from_env()).invoke(growth_initial),
    )
    output: Any = result if args.full_state else result["growth"]["result"]
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
