import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://d309nxlq8e8jph.cloudfront.net"),
  title: "RecallOps — Incident Memory for Reliability Teams",
  description: "An approval-gated incident agent that recalls unfinished fixes using CockroachDB memory and AWS Bedrock.",
  icons: { icon: "/recallops-mark.svg" },
  openGraph: {
    title: "RecallOps — Memory that closes the incident loop",
    description: "Recall verified operational history, surface unfinished fixes, and keep every action behind human approval.",
    type: "website",
    url: "/",
  },
};

export const viewport: Viewport = { themeColor: "#f5f7fb" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
