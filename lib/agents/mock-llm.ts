/**
 * Mock LLM 适配器：不调用真实 API，返回符合 schema 的固定候选。
 * 用于无 DeepSeek Key 时跑通完整演示流程（PRD 9.1 要求 mock 模式必须离线跑通）。
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// 简单延迟，模拟网络等待
function delay(ms = 400) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 根据 system prompt 里的 Agent 角色和 user message 里的任务，返回固定但合理的结构化结果。
 * 这不是真实 AI，只是让流程能跑通的占位实现。
 */
export async function callMockJson<T>(messages: ChatMessage[]): Promise<T> {
  await delay();
  const system = messages[0]?.content || "";
  const user = messages[1]?.content || "";

  // Supervisor Agent（首轮发散）
  if (system.includes("Supervisor Agent") && user.includes("首轮")) {
    return {
      need_memory: false,
      need_rag: false,
      need_external_tool: false,
      need_user_confirmation: false,
      context_plan: ["Global Brief", "must_keep / must_avoid", "平台与时长"],
      risk_flags: [],
    } as T;
  }

  // Supervisor Agent（受控生长）
  if (system.includes("Supervisor Agent") && user.includes("graph.grow")) {
    return {
      need_memory: true,
      need_rag: false,
      need_external_tool: false,
      context_plan: ["Global Brief", "主体契约", "祖先路径", "已采用邻域", "排除记忆"],
      risk_flags: [],
    } as T;
  }

  // Supervisor Agent（关系推荐）
  if (system.includes("Supervisor Agent") && user.includes("关系候选")) {
    return {
      need_memory: false,
      need_rag: false,
      need_external_tool: false,
      need_user_confirmation: false,
      context_plan: ["Global Brief", "两端点属性", "一度邻居", "已有关系"],
      risk_flags: [],
    } as T;
  }

  // Supervisor Agent（剧情收敛）
  if (system.includes("Supervisor Agent") && user.includes("收敛短视频剧情")) {
    return {
      need_memory: false,
      need_rag: false,
      need_external_tool: false,
      need_user_confirmation: true,
      context_plan: ["Global Brief", "已采用节点", "已采用关系", "时长约束"],
      risk_flags: [],
    } as T;
  }

  // Creative Agent（首轮发散）
  if (system.includes("Creative Agent") && user.includes("首轮发散")) {
    return {
      nodes: [
        { clientKey: "mock-char-1", category: "creative_element", subtype: "人物", title: "水枪国王", description: "戴透明王冠、用超长水枪发号施令的活动主角。", attributes: { 故事作用: "主角", 目标: "保卫王位" }, rationale: "mock · 从碎片想法提取人物" },
        { clientKey: "mock-prop-1", category: "creative_element", subtype: "道具", title: "会逃跑的王冠", description: "漂在水面、主动躲避挑战者的胜负标志。", attributes: { 特征: "拟人化", 剧情功能: "争夺目标" }, rationale: "mock · 拟人化方法" },
        { clientKey: "mock-conf-1", category: "motivation_conflict", subtype: "对抗", title: "十秒王位保卫战", description: "所有游客都能挑战现任国王，倒计时结束即换位。", attributes: { 发起者: "游客", 阻碍: "国王水枪压制", 风险: "失去王位" }, rationale: "mock · 卖点约束" },
        { clientKey: "mock-conf-2", category: "motivation_conflict", subtype: "身份错位", title: "菜鸟被全场低估", description: "新手误拿拖把参战，却发现隐藏水炮。", attributes: { 发起者: "新手", 作用对象: "国王", 阻碍: "装备劣势", 失败后果: "被淘汰" }, rationale: "mock · 身份错位方法" },
        { clientKey: "mock-event-1", category: "story_event", subtype: "开场", title: "全民挑战开启", description: "国王敲响权杖，全场设施瞬间变成对战机关。", attributes: { 参与者: "全场游客", 触发条件: "国王宣战", 行动: "水枪对战", 结果: "机关启动" }, rationale: "mock · 平台节奏约束" },
        { clientKey: "mock-event-2", category: "story_event", subtype: "反转", title: "最后一秒换王", description: "新手用隐藏水炮反超，透明王冠飞向他。", attributes: { 参与者: "新手", 触发条件: "倒计时最后3秒", 行动: "隐藏水炮反击", 结果: "王冠易主" }, rationale: "mock · 反转方法" },
      ],
    } as T;
  }

  // Creative Agent（生长候选）
  if (system.includes("Creative Agent") && user.includes("generate_growth_candidates")) {
    // 从 user message 里提取目标分类和数量
    const categoryMatch = user.match(/"targetCategory"\s*:\s*"(\w+)"/);
    const countMatch = user.match(/"candidateCount"\s*:\s*(\d)/);
    const parentMatch = user.match(/"expected_parent_ref"\s*:\s*"([^"]+)"/);
    const subjectMatch = user.match(/"narrativeSubjectIds"\s*:\s*\[\s*"([^"]+)"/);
    const featureMatch = user.match(/"productFeatureRefs"\s*:\s*\[\s*"([^"]+)"/);
    const category = categoryMatch?.[1] || "story_event";
    const count = Number(countMatch?.[1] || 2);
    const parentRef = parentMatch?.[1] || "mock-parent";
    const actorRefs = subjectMatch?.[1] ? [subjectMatch[1]] : [];
    const productFeatureRefs = featureMatch?.[1] ? [featureMatch[1]] : [];
    const nodes = [];
    for (let i = 1; i <= count; i++) {
      nodes.push({
        clientKey: `mock-grow-${i}`,
        parentRef,
        category,
        subtype: "mock 生长",
        title: `${category === "story_event" ? "后续事件" : category === "motivation_conflict" ? "新增阻碍" : "补充元素"} ${i}`,
        description: `mock 生成的第 ${i} 个候选节点，围绕当前节点继续发散。`,
        attributes: { 来源: "mock", 生长模式: "deepen" },
        rationale: "mock · 受控生长",
        actorRefs,
        productFeatureRefs,
        growthMode: "deepen",
        subjectContinuity: { status: "anchored", score: 0.8, note: "mock · 主体保持" },
      });
    }
    return { nodes } as T;
  }

  // Critic Agent
  if (system.includes("Critic Agent")) {
    return {
      pass: true,
      issues: [],
      summary: "mock · 语义审查通过",
    } as T;
  }

  // Story Agent（首轮准备度）
  if (system.includes("Story Agent") && user.includes("readiness_only")) {
    return {
      status: "ready_hint",
      score: 60,
      present_elements: ["人物", "冲突", "事件"],
      missing_elements: ["关系连线"],
      note: "mock · 等待用户采用候选节点后再进入剧情收敛",
    } as T;
  }

  // Story Agent（生长准备度）
  if (system.includes("Story Agent") && user.includes("growth_readiness_only")) {
    return {
      status: "ready_hint",
      score: 70,
      note: "mock · 采用后可继续收敛",
    } as T;
  }

  // Story Agent（剧情收敛）—— 用于 /api/graph/concept
  if (system.includes("Story Agent") && user.includes("story_converge")) {
    return {
      concept: "每个人都有十秒钟，成为水世界国王。",
      theme: "权力流转与平民逆袭",
      perspective: "旁观者+主角双线",
      core_conflict: "现任国王抵挡全场挑战者",
      main_line: "新手从被低估到反超称王",
      beats: [
        { phase: "HOOK · 0—3s", text: "水枪国王举起超长水枪，十支水枪同时对准王冠。", refs: [] },
        { phase: "发展 · 4—12s", text: "倒计时启动，全场设施化为水枪机关，游客集体加入王位争夺。", refs: [] },
        { phase: "转折 · 13—20s", text: "被低估的新手发现隐藏水炮，局势在最后三秒逆转。", refs: [] },
        { phase: "高潮 · 21—27s", text: "透明王冠飞离旧王，产品玩法在决胜动作中自然完成展示。", refs: [] },
        { phase: "CTA · 28—30s", text: "来体验，下一任水世界国王可能就是你。", refs: [] },
      ],
      selling_point_insertion: "水枪对战玩法即剧情核心机制",
      twist: "透明王冠最后一秒换人",
      cta: "立即开局，争夺你的王冠",
      shooting_feasibility: "水上乐园实景拍摄，单机位即可，后期加王冠特效",
    } as T;
  }

  // Creative Agent（关系推荐）—— 用于 /api/graph/relations
  if (system.includes("Creative Agent") && user.includes("relation_candidates")) {
    return {
      relations: [
        { label: "触发并推动", direction: "forward", rationale: "mock · 前者导致后者发生" },
        { label: "阻碍并升级", direction: "forward", rationale: "mock · 制造代价推动剧情升级" },
        { label: "形成反转", direction: "forward", rationale: "mock · 改变局势走向" },
        { label: "铺垫伏笔", direction: "both", rationale: "mock · 前者暗示后者" },
      ],
    } as T;
  }

  // 兜底：返回空对象
  return {} as T;
}
