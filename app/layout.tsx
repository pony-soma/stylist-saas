import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiNo",
  description: "美容師のための予約・顧客管理SaaS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
