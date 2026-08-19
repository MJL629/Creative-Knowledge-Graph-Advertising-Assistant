import type { AgentRunContext, CreativeAgentGateway, CreativeBrief } from "../contracts";
import { runGrowthPipeline } from "./growth-pipeline";
import { runInitialGraphPipeline, runRelationPipeline, runStoryConvergePipeline, type BriefInput } from "./graph-pipeline";

function toPipelineBrief(input: CreativeBrief): BriefInput {
  return {
    product: input.product,
    knownInformation: input.knownInformation ?? input.knownFacts?.join("\n"),
    ideaFragments: input.ideaFragments,
    mustKeep: input.mustKeep ?? [],
    mustAvoid: input.mustAvoid ?? input.forbidden ?? [],
    audience: input.audience,
    platform: input.platform ?? String(input.constraints?.platform ?? "抖音"),
    durationSeconds: input.durationSeconds ?? Number(input.constraints?.durationSeconds ?? 30),
    styles: input.styles ?? [],
    hotMemes: input.hotMemes ?? [],
    sellingPoints: input.sellingPoints ?? [],
  };
}

export class PipelineCreativeAgentGateway implements CreativeAgentGateway {
  async initialDivergence(input: CreativeBrief, context?: AgentRunContext, signal?: AbortSignal) {
    void context;
    return runInitialGraphPipeline(toPipelineBrief(input), signal);
  }

  async growNode(input: unknown, context?: AgentRunContext, signal?: AbortSignal) {
    void context;
    return runGrowthPipeline(input as Parameters<typeof runGrowthPipeline>[0], signal);
  }

  async suggestRelations(input: unknown, context?: AgentRunContext, signal?: AbortSignal) {
    void context;
    return runRelationPipeline(input as Parameters<typeof runRelationPipeline>[0], signal);
  }

  async convergeStory(input: unknown, context?: AgentRunContext, signal?: AbortSignal) {
    void context;
    return runStoryConvergePipeline(input as Parameters<typeof runStoryConvergePipeline>[0], signal);
  }
}

const creativeAgentGateway = new PipelineCreativeAgentGateway();
let registeredGateway: CreativeAgentGateway | undefined;

export function registerCreativeAgentGateway(gateway: CreativeAgentGateway) {
  registeredGateway = gateway;
}

export function getCreativeAgentGateway(): CreativeAgentGateway {
  return registeredGateway ?? creativeAgentGateway;
}
