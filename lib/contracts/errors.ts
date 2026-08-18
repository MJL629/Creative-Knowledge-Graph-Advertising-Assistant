export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  GRAPH_NOT_FOUND: "GRAPH_NOT_FOUND",
  GRAPH_REVISION_CONFLICT: "GRAPH_REVISION_CONFLICT",
  GRAPH_OPERATION_INVALID: "GRAPH_OPERATION_INVALID",
  GRAPH_DIVERGENCE_FAILED: "GRAPH_DIVERGENCE_FAILED",
  GROWTH_INPUT_INVALID: "GROWTH_INPUT_INVALID",
  GRAPH_GROWTH_FAILED: "GRAPH_GROWTH_FAILED",
  RELATIONS_INPUT_INVALID: "RELATIONS_INPUT_INVALID",
  RELATIONS_FAILED: "RELATIONS_FAILED",
  CONCEPT_INPUT_INVALID: "CONCEPT_INPUT_INVALID",
  CONCEPT_FAILED: "CONCEPT_FAILED",
  STORY_NOT_FOUND: "STORY_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
