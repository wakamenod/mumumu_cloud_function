import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import {onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {handleGetQuiz} from "./handlers/quizHandlers.js";
import {handleSubmitScore} from "./handlers/rankingHandlers.js";

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
// ローカルエミュレーター時は App Check を無効化する
// FUNCTIONS_EMULATOR は Firebase エミュレーターが自動でセットする環境変数
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

export const getQuizFunction = onCall(
  {enforceAppCheck: !isEmulator},
  async (request) => {
    return handleGetQuiz(request.data);
  }
);

/**
 * onCall: submitScore
 * クイズ終了後にスコアを検証し、ランクイン時に Firestore のランキングへ仮登録する。
 * サーバー側で答え合わせを行い、クライアントの自己申告スコアは使用しない（チート対策）。
 * ランクイン時は後続の registerUsernameFunction で使用する claimToken を返す。
 *
 * リクエスト形式: { level: string, answers: string[], startedAt: number }
 * レスポンス形式: { ranked, rank, correct_count, elapsed_time, claimToken }
 */
export const submitScoreFunction = onCall(
  {enforceAppCheck: !isEmulator},
  async (request) => {
    return handleSubmitScore(request.data);
  }
);
