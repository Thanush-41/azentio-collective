import { describe, expect, it } from "vitest";
import { identityFromToken, signIn, signOut, signUp } from "@/lib/services/auth";
import { listMemberships, provisionUser } from "@/lib/services/identity";
import { CLOSED, createTestDb } from "./helpers";

describe("email/password auth", () => {
  it("signs up, signs in, rejects bad passwords uniformly, and signs out", async () => {
    const db = await createTestDb();
    const a = await signUp(db, { email: "New@User.dev", password: "correct horse battery", name: "New" });
    expect(await identityFromToken(db, a.token)).toMatchObject({ email: "new@user.dev" });
    await expect(signUp(db, { email: "new@user.dev", password: "another password!", name: "X" })).rejects.toMatchObject({ status: 409 });
    await expect(signIn(db, { email: "new@user.dev", password: "wrong password" })).rejects.toMatchObject({ status: 401 });
    await expect(signIn(db, { email: "nobody@user.dev", password: "wrong password" })).rejects.toMatchObject({ status: 401 });
    const b = await signIn(db, { email: "NEW@user.dev", password: "correct horse battery" });
    await signOut(db, b.token);
    expect(await identityFromToken(db, b.token)).toBeNull();
  });
  it("a new account has no workspaces until a membership exists", async () => {
    const db = await createTestDb();
    const a = await signUp(db, { email: "plain@user.dev", password: "correct horse battery", name: "P" });
    await provisionUser(db, { userId: a.userId, email: a.email }, CLOSED);
    expect(await listMemberships(db, a.userId)).toEqual([]);
  });
});

describe("email verification", () => {
  it("requires the emailed single-use code; wrong, reused or superseded codes fail", async () => {
    const { issueVerificationCode, verifyEmailCode } = await import("@/lib/services/auth");
    const db = await createTestDb();
    let sent = "";
    const mail = async (_to: string, _s: string, text: string) => { sent = /(\d{6})/.exec(text)![1]; return { accepted: true }; };
    const a = await signUp(db, { email: "v@user.dev", password: "correct horse battery", name: "V" }, mail);
    expect((await identityFromToken(db, a.token))?.emailVerified).toBe(false);
    const first = sent;
    await expect(verifyEmailCode(db, a.userId, first === "000000" ? "111111" : "000000")).rejects.toMatchObject({ status: 400 });
    await issueVerificationCode(db, a.userId, a.email, mail); // supersedes the first code
    if (sent !== first) await expect(verifyEmailCode(db, a.userId, first)).rejects.toMatchObject({ status: 400 });
    await verifyEmailCode(db, a.userId, sent);
    expect((await identityFromToken(db, a.token))?.emailVerified).toBe(true);
    await expect(verifyEmailCode(db, a.userId, sent)).rejects.toMatchObject({ status: 400 }); // single use
  });
  it("reports honestly when no provider is configured", async () => {
    const db = await createTestDb();
    const a = await signUp(db, { email: "n@user.dev", password: "correct horse battery", name: "N" });
    expect(a.verification.emailSent).toBe(false);
  });
});
