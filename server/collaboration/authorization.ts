export interface VerifiedUser {
  uid: string;
}

export interface AuthorizationDependencies {
  isRoomMember(roomCode: string, uid: string): Promise<boolean>;
  verifyIdToken(token: string): Promise<VerifiedUser>;
}

export interface AuthorizedRoomDocument {
  roomCode: string;
  uid: string;
}

export function extractRoomCode(documentName: string): string {
  const match = /^console-room-([A-Z0-9]{4,12})$/.exec(documentName);
  if (!match) {
    throw new Error("Nome de documento inválido.");
  }
  return match[1];
}

export async function authorizeRoomDocument(
  token: string,
  documentName: string,
  dependencies: AuthorizationDependencies,
): Promise<AuthorizedRoomDocument> {
  if (!token.trim()) {
    throw new Error("Token Firebase ausente.");
  }

  const roomCode = extractRoomCode(documentName);
  const { uid } = await dependencies.verifyIdToken(token);
  if (!uid) {
    throw new Error("Token Firebase inválido.");
  }

  if (!(await dependencies.isRoomMember(roomCode, uid))) {
    throw new Error("Usuário não pertence a esta sala.");
  }

  return { roomCode, uid };
}
