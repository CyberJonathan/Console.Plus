import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeRoomDocument, extractRoomCode } from "./authorization.js";

test("accepts only the existing room-document naming format", () => {
  assert.equal(extractRoomCode("console-room-AB12CD"), "AB12CD");
  assert.throws(() => extractRoomCode("console-file-personal:uid"), /Nome de documento inválido/);
  assert.throws(() => extractRoomCode("console-room-../private"), /Nome de documento inválido/);
});

test("rejects missing and invalid Firebase tokens", async () => {
  const dependencies = {
    async verifyIdToken(token: string) {
      if (token !== "valid") throw new Error("Token Firebase inválido.");
      return { uid: "member-1" };
    },
    async isRoomMember() {
      return true;
    },
  };

  await assert.rejects(
    authorizeRoomDocument("", "console-room-AB12", dependencies),
    /Token Firebase ausente/,
  );
  await assert.rejects(
    authorizeRoomDocument("invalid", "console-room-AB12", dependencies),
    /Token Firebase inválido/,
  );
});

test("rejects authenticated users that are not room members", async () => {
  let membershipCheck: { roomCode: string; uid: string } | undefined;
  await assert.rejects(
    authorizeRoomDocument("valid", "console-room-AB12", {
      async verifyIdToken() {
        return { uid: "outsider" };
      },
      async isRoomMember(roomCode, uid) {
        membershipCheck = { roomCode, uid };
        return false;
      },
    }),
    /não pertence a esta sala/,
  );
  assert.deepEqual(membershipCheck, { roomCode: "AB12", uid: "outsider" });
});
