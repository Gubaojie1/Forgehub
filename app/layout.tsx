import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    metadataBase: new URL(origin),
    icons: { icon: "/dnake-mark.png", shortcut: "/dnake-mark.png", apple: "/dnake-mark.png" },
    title: "狄耐克脑机交互研发平台",
    description: "厦门狄耐克智能科技股份有限公司脑机交互事业部产品、固件、协议、工具与发布协作平台",
    openGraph: { title: "狄耐克脑机交互研发平台", description: "固件、协议、工具、审批和成员协作的一体化研发平台" },
    twitter: { card: "summary", title: "狄耐克脑机交互研发平台", description: "固件、协议、工具、审批和成员协作的一体化研发平台" },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
