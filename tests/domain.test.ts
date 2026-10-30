import { describe, expect, it } from "vitest";
import { playerFor } from "@/lib/domain/media";
import { answerQuestion } from "@/lib/domain/aira";
import { scanPrivacy } from "@/lib/domain/privacy";
import { can, CLIENT_ASSIGNABLE_ROLES } from "@/lib/domain/rbac";
import { createObservationSchema, inviteSchema } from "@/lib/domain/schemas";
import { canTransition, IMPROVEMENT_TRANSITIONS, OBSERVATION_TRANSITIONS } from "@/lib/domain/workflow";

describe("workflow transition map", () => {
  it("permits the documented transitions", () => {
    expect(canTransition(OBSERVATION_TRANSITIONS, "draft", "submitted")).toBe(true);
    expect(canTransition(OBSERVATION_TRANSITIONS, "clarification_requested", "draft")).toBe(true);
    expect(canTransition(OBSERVATION_TRANSITIONS, "reported", "published")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(canTransition(OBSERVATION_TRANSITIONS, "draft", "published")).toBe(false);
    expect(canTransition(OBSERVATION_TRANSITIONS, "withdrawn", "published")).toBe(false);
    expect(canTransition(OBSERVATION_TRANSITIONS, "rejected", "submitted")).toBe(false);
    expect(canTransition(IMPROVEMENT_TRANSITIONS, "Released", "Planned")).toBe(false);
  });
});

describe("privacy scan", () => {
  it("flags obvious restricted identifiers", () => {
    expect(scanPrivacy("contact jane@bank.com")).toContain("email address");
    expect(scanPrivacy("account 1234567890123")).toContain("account or card number");
    expect(scanPrivacy("password: hunter2")).toContain("credential");
  });
  it("passes clean text", () => expect(scanPrivacy("Seasonal cash flows need context in 2026-Q3.")).toEqual([]));
});

describe("validation", () => {
  const base = { offering: "Financial Analysis Intelligence", title: "Title", industry: "Banking", region: "India", observationPeriod: "2026-Q3", evidenceType: "Synthetic", confidence: "Medium", description: "A long enough description.", sharingIntent: "private" };
  it("rejects over-long strings instead of truncating", () => expect(createObservationSchema.safeParse({ ...base, description: "x".repeat(3001) }).success).toBe(false));
  it("rejects invalid enums", () => {
    expect(createObservationSchema.safeParse({ ...base, confidence: "Certain" }).success).toBe(false);
    expect(createObservationSchema.safeParse({ ...base, sharingIntent: "public" }).success).toBe(false);
    expect(createObservationSchema.safeParse(base).success).toBe(true);
  });
  it("shared-metadata fields accept only controlled values", () => {
    expect(createObservationSchema.safeParse({ ...base, region: "Pune branch" }).success).toBe(false);
    expect(createObservationSchema.safeParse({ ...base, observationPeriod: "last Tuesday" }).success).toBe(false);
    expect(createObservationSchema.safeParse({ ...base, offering: "Secret roadmap product" }).success).toBe(false);
  });
  it("client invitations cannot name staff roles", () => {
    expect(inviteSchema.safeParse({ email: "a@b.co", role: "moderator" }).success).toBe(false);
    expect(CLIENT_ASSIGNABLE_ROLES).not.toContain("moderator");
  });
});

describe("rbac", () => {
  it("keeps privileged permissions away from clients", () => {
    expect(can("client_member", "moderate")).toBe(false);
    expect(can("client_admin", "improvement:manage")).toBe(false);
    expect(can("moderator", "moderate")).toBe(true);
  });
});

describe("AIRA", () => {
  const theme = { id: "T1", title: "Seasonality context", topic: "seasonal cash-flow", summary: "Seasonal flows need context.", suggestedImprovement: "x", offering: "FAI" };
  const pub = (id: string, orgId: string, themeId: string | null) => ({ id, approvedText: "t", orgId, themeId });
  it("answers only with three organisations and returns retrieved references", () => {
    const a = answerQuestion("What seasonality concerns exist?", [theme], [pub("P1", "a", "T1"), pub("P2", "b", "T1"), pub("P3", "c", "T1")]);
    expect(a.status).toBe("answered");
    expect(a.references).toEqual(["P1", "P2", "P3"]);
  });
  it("returns insufficient evidence below the threshold or when unrelated publications exist", () => {
    expect(answerQuestion("seasonality?", [theme], [pub("P1", "a", "T1"), pub("P2", "b", "T1")]).status).toBe("insufficient_evidence");
    expect(answerQuestion("seasonality?", [theme], [pub("P1", "a", null), pub("P2", "b", null), pub("P3", "c", null)]).status).toBe("insufficient_evidence");
    expect(answerQuestion("quantum encryption roadmap", [theme], [pub("P1", "a", "T1"), pub("P2", "b", "T1"), pub("P3", "c", "T1")]).status).toBe("insufficient_evidence");
  });
});

describe("recording embeds", () => {
  it("maps Drive, YouTube, Vimeo and mp4 links to safe players; anything else is a plain link", () => {
    expect(playerFor("https://drive.google.com/file/d/1AbC_dEf-123/view?usp=sharing")).toMatchObject({ type: "iframe", src: "https://drive.google.com/file/d/1AbC_dEf-123/preview" });
    expect(playerFor("https://drive.google.com/open?id=XYZ12345")).toMatchObject({ type: "iframe", src: "https://drive.google.com/file/d/XYZ12345/preview" });
    expect(playerFor("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ type: "iframe", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
    expect(playerFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({ type: "iframe" });
    expect(playerFor("https://vimeo.com/123456789")).toMatchObject({ type: "iframe", src: "https://player.vimeo.com/video/123456789" });
    expect(playerFor("https://cdn.example.com/demo.mp4")).toMatchObject({ type: "video" });
    expect(playerFor("https://evil.example.com/page")).toMatchObject({ type: "link" });
    expect(playerFor("http://drive.google.com/file/d/abc/view")).toMatchObject({ type: "link" });
    expect(playerFor("javascript:alert(1)")).toMatchObject({ type: "link" });
  });
});
