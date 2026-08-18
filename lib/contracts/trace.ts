export interface AgentTrace {
  id: string;
  projectId?: string;
  requestId?: string;
  agent: "supervisor" | "creative" | "critic" | "story" | string;
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
}

export interface AgentTraceSink {
  record(trace: AgentTrace): Promise<void>;
}
