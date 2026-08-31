export interface DevelopmentRetrievalQuerySample {
  query: string;
  topK: number;
  expectedRelevantIds: string[];
  note: string;
}

/** Behaviour samples for local keyword retrieval, not a formal RAG evaluation dataset. */
export const developmentRetrievalQuerySamples: DevelopmentRetrievalQuerySample[] = [
  { query: "饮料 倒计时挑战", topK: 3, expectedRelevantIds: ["dev_case_001_countdown_beverage"], note: "品类 + Hook" },
  { query: "小红书 护肤 对照实验", topK: 3, expectedRelevantIds: ["dev_case_002_split_screen_skincare"], note: "平台 + 品类 + Hook" },
  { query: "游戏 新手 翻盘", topK: 3, expectedRelevantIds: ["dev_case_003_underdog_game"], note: "品类 + 叙事结果" },
  { query: "周末旅行 背包 容量", topK: 3, expectedRelevantIds: ["dev_case_004_one_bag_travel"], note: "用户场景 + 创意元素" },
  { query: "通勤 降噪 声音对比", topK: 3, expectedRelevantIds: ["dev_case_005_sound_first_headphones"], note: "受众场景 + 卖点表达" },
  { query: "倒放 家常菜 教程", topK: 3, expectedRelevantIds: ["dev_case_006_reverse_recipe"], note: "故事结构 + 标签" },
  { query: "宠物 第一视角 探索", topK: 3, expectedRelevantIds: ["dev_case_007_pet_point_of_view"], note: "创意视角 + 标签" },
  { query: "书桌 收纳 前后对比", topK: 3, expectedRelevantIds: ["dev_case_008_desk_transformation"], note: "品类 + 表现手法" },
  { query: "旅行 语言学习 评论选择", topK: 3, expectedRelevantIds: ["dev_case_009_choice_language_course"], note: "场景 + CTA" },
  { query: "咖啡 无缝循环 晨间", topK: 3, expectedRelevantIds: ["dev_case_010_morning_coffee_loop"], note: "品类 + Hook + 情绪氛围" },
  { query: "图书 悬念 猜书名", topK: 3, expectedRelevantIds: ["dev_case_011_mystery_book"], note: "品类 + Hook + CTA" },
  { query: "职场人 五分钟 健身打卡", topK: 3, expectedRelevantIds: ["dev_case_012_fitness_micro_goal"], note: "受众 + 微目标 + CTA" },
];
