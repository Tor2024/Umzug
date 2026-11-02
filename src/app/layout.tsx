import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://umzug-seven.vercel.app"),
  title: {
    default: "Помощник с переездом",
    template: "%s | Помощник с переездом",
  },
  description: "Расчёт и организация переезда по Германии: честная цена, экипаж, машина, документы.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-page text-ink font-sans">{children}</body>
    </html>
  );
}
