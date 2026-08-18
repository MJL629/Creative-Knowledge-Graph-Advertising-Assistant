import type { RetrievalProvider, RetrievalQuery, RetrievalResult } from "../contracts";

const mockHits = [
  {
    id: "mock_case_water_battle_hook",
    title: "水枪对战开场钩子",
    content: "用明确倒计时、即时挑战和可视化胜负标志制造前三秒注意力。",
    score: 0.92,
    metadata: { genre: "short-video", pattern: "countdown_challenge" },
    source: { name: "Mock Creative Method Library" },
  },
  {
    id: "mock_case_identity_reversal",
    title: "身份错位反转",
    content: "让被低估的新手在最后一拍利用环境机制反超，形成记忆点。",
    score: 0.84,
    metadata: { genre: "short-video", pattern: "underdog_twist" },
    source: { name: "Mock Creative Method Library" },
  },
];

export class MockRetrievalProvider implements RetrievalProvider {
  async retrieve(input: RetrievalQuery, signal?: AbortSignal): Promise<RetrievalResult> {
    signal?.throwIfAborted();
    const topK = Math.max(1, Math.min(Number(input.topK ?? mockHits.length), mockHits.length));
    return {
      query: input.query,
      hits: mockHits.slice(0, topK),
    };
  }
}
