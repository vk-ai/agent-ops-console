import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav } from "@/components/Nav";
import { RunStreamProvider } from "@/components/RunStreamProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "agent-ops-console",
  description: "Learning project: an operator console for agent-runtime-gcp and mcp-integration-hub.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <RunStreamProvider>
          <Suspense fallback={<header className="nav"><div className="brand">agent-ops-console</div></header>}>
            <Nav />
          </Suspense>
          <main>{children}</main>
        </RunStreamProvider>
      </body>
    </html>
  );
}
