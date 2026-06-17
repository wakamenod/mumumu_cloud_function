import {HttpsError} from "firebase-functions/v2/https";
import {createUser, getUserById} from "../services/userService.js";
import * as logger from "firebase-functions/logger";

/** onCall ハンドラが受け取る最低限の認証情報 */
export interface CallableAuth {
  uid: string;
  token: Record<string, unknown>;
}

/**
 * createUser ハンドラのコアロジック。
 * onCall から auth・data を受け取り、バリデーション後にユーザーを作成する。
 */
export async function handleCreateUser(
  auth: CallableAuth | undefined,
  data: unknown
) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "認証が必要です。");
  }

  const {displayName, email} = (data ?? {}) as {
    displayName?: unknown;
    email?: unknown;
  };

  if (typeof displayName !== "string" || displayName.trim() === "") {
    throw new HttpsError("invalid-argument", "displayName は必須です。");
  }
  if (typeof email !== "string" || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "有効な email を指定してください。");
  }

  const uid = auth.uid;
  logger.info(`createUser called for uid=${uid}`);

  const user = await createUser(uid, {displayName: displayName.trim(), email});
  return {user};
}

/**
 * getUser ハンドラのコアロジック。
 */
export async function handleGetUser(
  auth: CallableAuth | undefined,
  data: unknown
) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "認証が必要です。");
  }

  const {uid} = (data ?? {}) as {uid?: unknown};
  if (typeof uid !== "string" || uid.trim() === "") {
    throw new HttpsError("invalid-argument", "uid は必須です。");
  }

  const user = await getUserById(uid);
  if (!user) {
    throw new HttpsError("not-found", `uid=${uid} のユーザーは存在しません。`);
  }

  return {user};
}
