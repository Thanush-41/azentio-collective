import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Azentio Collective — Governed intelligence",
  description: "A secure collaboration portal that turns approved client observations into evidence-linked product improvements.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
