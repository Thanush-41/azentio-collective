import { notFound } from "next/navigation";
import { PortalApp } from "@/components/portal-app";
import { ALL_PATHS, normalizePath } from "@/lib/routes";

export default async function CatchAll({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  // Unknown URLs are a real 404 (never a workspace chooser, never a private-route probe).
  if (!ALL_PATHS.includes(normalizePath(`/${path.join("/")}`))) notFound();
  return <PortalApp />;
}
