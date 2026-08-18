export interface RetrievalQuery {
  projectId?: string;
  query: string;
  topK?: number;
  filters?: Record<string, unknown>;
}

export interface RetrievalHit {
  id: string;
  title?: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  source?: {
    name?: string;
    url?: string;
  };
}

export interface RetrievalResult {
  query: string;
  hits: RetrievalHit[];
}

export interface RetrievalProvider {
  retrieve(input: RetrievalQuery, signal?: AbortSignal): Promise<RetrievalResult>;
}
