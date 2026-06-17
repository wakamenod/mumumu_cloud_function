import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import {onCall} from "firebase-functions/v2/https";
import * as authV1 from "firebase-functions/v1/auth";
import * as logger from "firebase-functions/logger";
import {createUser} from "./services/userService.js";
import {handleCreateUser, handleGetUser} from "./handlers/userHandlers.js";

// Firebase Admin SDK の初期化
admin.initializeApp();

setGlobalOptions({maxInstances: 10});

/**
 * GET /helloWorld
 * ヘルスチェック用エンドポイント。サービスの稼働確認に使用する。
 */
export const helloWorld = onRequest((request, response) => {
  logger.info("helloWorld called", {structuredData: true});
  response.json({
    message: "Hello from Firebase!",
    timestamp: new Date().toISOString(),
  });
});

/**
 * onCall: createUser
 * クライアントからユーザー情報を受け取り Firestore にドキュメントを作成する。
 * 認証済みユーザーのみ呼び出し可能。
 */
export const createUserFunction = onCall(async (request) => {
  return handleCreateUser(request.auth, request.data);
});

/**
 * onCall: getUser
 * 指定した uid のユーザー情報を返す。認証済みユーザーのみ呼び出し可能。
 */
export const getUserFunction = onCall(async (request) => {
  return handleGetUser(request.auth, request.data);
});

/**
 * Auth トリガー: onUserCreated
 * Firebase Auth でユーザーが作成された際に自動的に Firestore ドキュメントを作成する。
 */
export const onUserCreatedTrigger = authV1.user().onCreate(
  async (user) => {
    const {uid, email, displayName} = user;
    logger.info(`New user created: uid=${uid}, email=${email}`);

    await createUser(uid, {
      displayName: displayName ?? "名無しユーザー",
      email: email ?? "",
    });
  }
);
