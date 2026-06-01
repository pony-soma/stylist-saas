import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stylist SaaS",
  description: "SaaS application for freelance hair stylists",
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
