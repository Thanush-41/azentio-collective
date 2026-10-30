// Single list of valid paths, shared by the server (genuine 404s for anything else) and the client router.
export const PUBLIC_PATHS = ["/", "/products", "/solutions", "/insights", "/media", "/lab", "/live", "/about", "/connect", "/hackathon/register", "/login", "/signin", "/register", "/accept-invite"];
export const WORKSPACE_PATHS = ["/learning", "/audit", "/moderation", "/moderation/themes", "/client/dashboard", "/client/sandbox", "/client/observations", "/client/learning", "/client/members", "/client/updates", "/client/support",
  "/employee/dashboard", "/employee/playground", "/employee/lab", "/employee/updates", "/employee/knowledge", "/employee/content", "/employee/ideas", "/employee/entitlements", "/employee/support"];
export const ALL_PATHS = [...PUBLIC_PATHS, ...WORKSPACE_PATHS];
export const normalizePath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p) || "/";
