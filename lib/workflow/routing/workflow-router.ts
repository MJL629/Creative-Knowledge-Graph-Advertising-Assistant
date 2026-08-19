import { END } from "@langchain/langgraph";

import type { CreativeState } from "../creative-state";

export function routeAfterContext(state: CreativeState) {
  return state.needRag ? "retrieve_context" : routeCreativeIntent(state);
}

export function routeCreativeIntent(state: CreativeState) {
  switch (state.intent) {
    case "start": return "creative_divergence";
    case "grow": return "creative_growth";
    case "relations": return "relation_suggestion";
    case "concept": return "story_convergence";
  }
}

export function routeAfterCommit(state: CreativeState) {
  switch (state.nextAction) {
    case "grow": return "creative_growth";
    case "relations": return "relation_suggestion";
    case "concept": return "story_convergence";
    default: return END;
  }
}
