import {HttpsError} from "firebase-functions/v2/https";
import {fetchQuizData} from "../services/quizService.js";
import {submitScore, SubmitScoreResult} from "../services/rankingService.js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 出題数 */
const QUESTION_COUNT = 20;

/** 有効なレベル識別子 */
const VALID_LEVELS = new Set([
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
]);

/**
 * 異常タイム判定の閾値係数（秒/問）。
 * elapsed_time < QUESTION_COUNT * MIN_SECONDS_PER_QUESTION の場合は異常とみなす。
 */
const MIN_SECONDS_PER_QUESTION = 0.5;

// ---------------------------------------------------------------------------
// ハンドラー
// ---------------------------------------------------------------------------

/**
 * スコア仮登録ハンドラー。
 *
 * 1. 入力バリデーション
 * 2. Storage から問題データを取得しサーバー側で答え合わせ → correct_count を算出
 * 3. elapsed_time を算出し異常タイムを検出
 * 4. Firestore Transaction でランキングに仮登録
 * 5. ランクイン時は claimToken を返す
 *
 * @param {unknown} data - クライアントから受け取った入力データ
 * @return {Promise<SubmitScoreResult>} ランクイン結果と claimToken
 */
export async function handleSubmitScore(
  data: unknown,
): Promise<SubmitScoreResult> {
  // --- 入力バリデーション ---
  if (!data || typeof data !== "object") {
    throw new HttpsError(
      "invalid-argument",
      "リクエストボディが不正です。",
    );
  }

  const d = data as Record<string, unknown>;

  // level
  if (typeof d.level !== "string" || !VALID_LEVELS.has(d.level)) {
    throw new HttpsError(
      "invalid-argument",
      `無効なレベル "${String(d.level)}" です。有効な値は A 〜 M です。`,
    );
  }
  const level = d.level;

  // answers
  if (
    !Array.isArray(d.answers) ||
    d.answers.length !== QUESTION_COUNT ||
    !d.answers.every((a) => typeof a === "string")
  ) {
    throw new HttpsError(
      "invalid-argument",
      `"answers" は文字列を ${QUESTION_COUNT} 件含む配列で指定してください。`,
    );
  }
  const answers = d.answers as string[];

  // startedAt
  if (typeof d.startedAt !== "number" || !Number.isFinite(d.startedAt)) {
    throw new HttpsError(
      "invalid-argument",
      '"startedAt" は有限な数値（Unix タイムスタンプ ミリ秒）で指定してください。',
    );
  }
  const startedAt = d.startedAt;

  // --- elapsed_time の算出と異常タイム検出 ---
  const now = Date.now();
  const elapsedTime = (now - startedAt) / 1000;

  const minElapsed = QUESTION_COUNT * MIN_SECONDS_PER_QUESTION;
  if (elapsedTime < minElapsed) {
    throw new HttpsError(
      "deadline-exceeded",
      `経過時間が短すぎます（${elapsedTime.toFixed(2)} 秒）。` +
        ` 最小許容時間: ${minElapsed} 秒。`,
    );
  }

  // --- サーバー側答え合わせ ---
  const questions = await fetchQuizData(level).catch(() => {
    throw new HttpsError(
      "not-found",
      `レベル "${level}" の問題データが見つかりません。`,
    );
  });

  let correctCount = 0;
  for (let i = 0; i < QUESTION_COUNT; i++) {
    if (answers[i] === questions[i]?.answer) {
      correctCount++;
    }
  }

  // --- Firestore Transaction でランキングに仮登録 ---
  return submitScore(level, correctCount, elapsedTime);
}
