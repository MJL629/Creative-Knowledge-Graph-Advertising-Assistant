import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "创意织图 · PRD 架构 Demo",
  description: "从 Brief 到可追溯短视频剧情的创意知识图谱演示。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
