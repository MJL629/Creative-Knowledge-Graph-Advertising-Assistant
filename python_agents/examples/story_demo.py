"""Resolve candidate decisions and generate Story from the adopted subgraph."""

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
    build_story_graph,
    create_initial_state,
    create_story_run_state,
)
from creative_graph_agents.model import build_model_from_env


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Run first round, resolve every candidate, then converge Story"
    )
    parser.add_argument(
        "--brief",
        type=Path,
        default=Path(__file__).with_name("brief.json"),
    )
    parser.add_argument(
        "--adopt-keys",
        default="element_1,conflict_1,event_1",
        help="Comma-separated first-round client_key values to adopt",
    )
    parser.add_argument("--title", default="国王水枪挑战")
    parser.add_argument("--full-state", action="store_true")
    args = parser.parse_args()

    brief = cast(dict[str, Any], json.loads(args.brief.read_text(encoding="utf-8")))
    first_round_id = "story-demo-first-round"
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
    all_keys = {
        candidate["client_key"]
        for candidate in first_round["final_result"]["candidates"]
    }
    adopted_keys = {
        key.strip() for key in args.adopt_keys.split(",") if key.strip()
    }
    unknown = adopted_keys - all_keys
    if unknown:
        raise ValueError(f"Unknown --adopt-keys: {sorted(unknown)}")
    selected = apply_first_round_decisions(
        first_round,
        adopted_client_keys=sorted(adopted_keys),
        rejected_client_keys=sorted(all_keys - adopted_keys),
        graph_version=1,
    )
    story_initial = create_story_run_state(
        selected,
        story_run_id="story-demo-001",
        title_instruction=args.title,
    )
    result = cast(
        SharedState,
        build_story_graph(build_model_from_env()).invoke(story_initial),
    )
    output: Any = result if args.full_state else result["story"]["result"]
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
