import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "创意生长图谱 · AI Creative Graph",
  description: "从碎片想法开始，把灵感长成一张可编辑、可追溯的短视频剧情图谱。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
