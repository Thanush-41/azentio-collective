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
