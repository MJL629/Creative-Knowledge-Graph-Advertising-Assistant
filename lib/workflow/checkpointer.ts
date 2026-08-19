import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import type { WorkflowCheckpointerProvider } from "./workflow-types";

export class MemoryWorkflowCheckpointerProvider implements WorkflowCheckpointerProvider {
  private readonly checkpointer = new MemorySaver();
  readonly durable = false;
  readonly name = "memory";

  getCheckpointer() {
    return this.checkpointer;
  }
}

export class PostgresWorkflowCheckpointerProvider implements WorkflowCheckpointerProvider {
  private constructor(private readonly checkpointer: PostgresSaver) {}

  readonly durable = true;
  readonly name = "postgres";

  static async create(databaseUrl: string, schema = "langgraph") {
    if (!databaseUrl.trim()) throw new Error("A PostgreSQL URL is required for durable workflow checkpoints");
    const checkpointer = PostgresSaver.fromConnString(databaseUrl, { schema });
    await checkpointer.setup();
    return new PostgresWorkflowCheckpointerProvider(checkpointer);
  }

  getCheckpointer() {
    return this.checkpointer;
  }

  async close() {
    await this.checkpointer.end();
  }
}
