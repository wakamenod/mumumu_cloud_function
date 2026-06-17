import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {handleGetQuiz} from "./handlers/quizHandlers.js";

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
 * onCall: getQuiz
 * 指定されたレベル（A〜L）の問題データを Firebase Storage から取得し、
 * シャッフルした 20 問を返す。
 *
 * enforceAppCheck: true により、有効な App Check トークンを持つ正規アプリ
 * からのリクエストのみを受け付ける。トークンが無効・欠落の場合は
 * Firebase SDK が自動的に UNAUTHENTICATED エラーを返す。
 *
 * リクエスト形式: { levels: string[] }  例: { levels: ["A", "C"] }
 * レスポンス形式: { questions: Array<{ order, id, question, answer_hash }> }
 */
export const getQuizFunction = onCall(
  {enforceAppCheck: true},
  async (request) => {
    return handleGetQuiz(request.data);
  }
);
