"""Command-line demo for the Python multi-agent workflow."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any, cast

from .model import build_model_from_env
from .state import SharedState, create_initial_state
from .workflow import build_first_round_graph


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Run first-round creative divergence")
    parser.add_argument("--brief", required=True, type=Path, help="Path to a UTF-8 JSON brief")
    parser.add_argument("--task-id", default="creative-demo")
    parser.add_argument("--max-iterations", type=int, default=2)
    parser.add_argument(
        "--full-state",
        action="store_true",
        help="Print the complete SharedState instead of only final_result",
    )
    args = parser.parse_args()

    brief = cast(dict[str, Any], json.loads(args.brief.read_text(encoding="utf-8")))
    initial = create_initial_state(
        args.task_id,
        json.dumps(brief, ensure_ascii=False),
        brief,
        max_iterations=args.max_iterations,
    )
    result = cast(SharedState, build_first_round_graph(build_model_from_env()).invoke(initial))
    output: Any = result if args.full_state else result["final_result"]
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
