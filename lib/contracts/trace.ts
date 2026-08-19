export interface AgentTrace {
  id: string;
  projectId?: string;
  requestId?: string;
  threadId?: string;
  agent: "supervisor" | "creative" | "critic" | "story" | string;
  workflowNode?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion?: string;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  success: boolean;
  errorCode?: string;
  retryCount?: number;
  retrievalHitCount?: number;
}

export interface AgentTraceSink {
  record(trace: AgentTrace): Promise<void>;
}
