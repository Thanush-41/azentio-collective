export type MediaPlayer = { type: "iframe" | "video" | "link"; src: string; host: string };

/** Turns a shared recording link into something safe to embed. Unknown hosts fall back to a plain link. */
export function playerFor(raw: string): MediaPlayer {
  let u: URL;
  try { u = new URL(raw); } catch { return { type: "link", src: raw, host: "" }; }
  const host = u.hostname.replace(/^www\./, "");
  if (u.protocol !== "https:") return { type: "link", src: raw, host };
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id) return { type: "iframe", src: `https://drive.google.com/file/d/${id}/preview`, host };
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? /\/(?:embed|shorts)\/([\w-]+)/.exec(u.pathname)?.[1];
    if (id && /^[\w-]{6,}$/.test(id)) return { type: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}`, host };
  }
  if (host === "vimeo.com") {
    const id = /^\/(\d+)/.exec(u.pathname)?.[1];
    if (id) return { type: "iframe", src: `https://player.vimeo.com/video/${id}`, host };
  }
  if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { type: "video", src: raw, host };
  return { type: "link", src: raw, host };
}
