import {HttpsError} from "firebase-functions/v2/https";
import {fetchQuizData} from "../services/quizService.js";
import {
  submitScore,
  SubmitScoreResult,
  registerUsername,
  RegisterUsernameResult,
  getRanking,
  GetRankingResult,
  RankingError,
} from "../services/rankingService.js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 出題数 */
const QUESTION_COUNT = 7;

/** 有効なレベル識別子 */
const VALID_LEVELS = new Set([
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
]);

/**
 * 異常タイム判定の閾値係数（秒/問）。
 * elapsed_time < QUESTION_COUNT * MIN_SECONDS_PER_QUESTION の場合は異常とみなす。
 */
const MIN_SECONDS_PER_QUESTION = 0.5;

/** UUID v4 の正規表現 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** username の正規表現（5文字・英大文字） */
const USERNAME_REGEX = /^[A-Z]{5}$/;

// ---------------------------------------------------------------------------
// ハンドラー
// ---------------------------------------------------------------------------

/**
 * スコア仮登録ハンドラー。
 *
 * 1. 入力バリデーション
 * 2. Storage から問題データを取得し、問題 ID をキーにしたマップでサーバー側答え合わせ → correct_count を算出
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
    !d.answers.every(
      (a) =>
        a !== null &&
        typeof a === "object" &&
        typeof (a as Record<string, unknown>).id === "number" &&
        typeof (a as Record<string, unknown>).answer === "string",
    )
  ) {
    throw new HttpsError(
      "invalid-argument",
      "\"answers\" は { id: number; answer: string } を " +
      `${QUESTION_COUNT} 件含む配列で指定してください。`,
    );
  }
  const answers = d.answers as {id: number; answer: string}[];

  // startedAt
  if (typeof d.startedAt !== "number" || !Number.isFinite(d.startedAt)) {
    throw new HttpsError(
      "invalid-argument",
      "\"startedAt\" は有限な数値（Unix タイムスタンプ ミリ秒）で指定してください。",
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

  const questionMap = new Map(questions.map((q) => [q.id, q]));

  let correctCount = 0;
  for (const {id, answer} of answers) {
    if (questionMap.get(id)?.answer === answer) {
      correctCount++;
    }
  }

  // --- Firestore Transaction でランキングに仮登録 ---
  return submitScore(level, correctCount, elapsedTime);
}

/**
 * ユーザー名本登録ハンドラー。
 *
 * 1. 入力バリデーション（level / claimToken / username）
 * 2. registerUsername() で claimToken を検証し username を書き込む
 * 3. RankingError を HttpsError に変換して返す
 *
 * @param {unknown} data - クライアントから受け取った入力データ
 * @return {Promise<RegisterUsernameResult>} 登録結果と確定順位
 */
export async function handleRegisterUsername(
  data: unknown,
): Promise<RegisterUsernameResult> {
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

  // claimToken（UUID v4 形式チェック）
  if (typeof d.claimToken !== "string" || !UUID_V4_REGEX.test(d.claimToken)) {
    throw new HttpsError(
      "invalid-argument",
      "\"claimToken\" は UUID v4 形式の文字列で指定してください。",
    );
  }
  const claimToken = d.claimToken;

  // username（5文字・英大文字）
  if (typeof d.username !== "string" || !USERNAME_REGEX.test(d.username)) {
    throw new HttpsError(
      "invalid-argument",
      "\"username\" は英大文字（A〜Z）5文字で指定してください。",
    );
  }
  const username = d.username;

  // --- Firestore Transaction でユーザー名を本登録 ---
  try {
    return await registerUsername(level, claimToken, username);
  } catch (e) {
    if (e instanceof RankingError) {
      throw new HttpsError(e.code, e.message);
    }
    throw e;
  }
}

/**
 * ランキング一覧取得ハンドラー。
 *
 * 1. 入力バリデーション（level: A〜M）
 * 2. getRanking() で Firestore から最新のランキングデータを取得して返す
 *
 * @param {unknown} data - クライアントから受け取った入力データ
 * @return {Promise<GetRankingResult>} 最新の上位 20 件（claim_token 除外済み）
 */
export async function handleGetRanking(
  data: unknown,
): Promise<GetRankingResult> {
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

  // --- Firestore からランキング一覧を取得 ---
  return getRanking(level);
}
