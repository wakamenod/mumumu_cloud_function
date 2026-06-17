// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as admin from "firebase-admin";

/** ユーザー作成のリクエスト型 */
export interface CreateUserRequest {
  displayName: string;
  email: string;
}

/** アプリ内ユーザーの型 */
export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
  createdAt: FirebaseFirestore.Timestamp;
}

/** Firestore のコレクション名 */
const USERS_COLLECTION = "users";

/**
 * Firestore にユーザードキュメントを作成する。
 * Firebase Auth で作成済みの uid を受け取り、対応するドキュメントを保存する。
 */
export async function createUser(
  uid: string,
  data: CreateUserRequest
): Promise<AppUser> {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  const user: AppUser = {
    uid,
    displayName: data.displayName,
    email: data.email,
    createdAt: now,
  };

  await db.collection(USERS_COLLECTION).doc(uid).set(user);
  return user;
}

/**
 * Firestore からユーザードキュメントを取得する。
 * 存在しない場合は null を返す。
 */
export async function getUserById(uid: string): Promise<AppUser | null> {
  const db = admin.firestore();
  const doc = await db.collection(USERS_COLLECTION).doc(uid).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as AppUser;
}
