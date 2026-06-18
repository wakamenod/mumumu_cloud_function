import {HttpsError} from "firebase-functions/v2/https";
import {
  fetchQuizData,
  hashAnswer,
  QuizQuestion,
} from "../services/quizService.js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 出題数 */
const QUESTION_COUNT = 20;

/** 有効なレベル識別子 */
const VALID_LEVELS = new Set([
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
]);

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/**
 * Fisher-Yates シャッフル（in-place）。
 * 配列の要素をランダムな順序に並び替える。
 *
 * @param {T[]} array - シャッフル対象の配列
 * @return {T[]} シャッフル後の配列（同一参照）
 */
function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// ---------------------------------------------------------------------------
// ハンドラー
// ---------------------------------------------------------------------------

/**
 * クイズ問題取得ハンドラー。
 *
 * 指定された 1 つ以上のレベルから問題プールを構築し、
 * シャッフル後の先頭 20 問を返す。
 * 認証不要（ユーザー登録なし）。
 *
 * @param {unknown} data - クライアントから受け取った入力データ
 * @return {{ questions: QuizQuestion[] }} 20 問分のクイズデータ
 */
export async function handleGetQuiz(
  data: unknown,
): Promise<{questions: QuizQuestion[]}> {
  // --- 入力バリデーション ---
  if (
    !data ||
    typeof data !== "object" ||
    !("levels" in data) ||
    !Array.isArray((data as {levels: unknown}).levels)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "`levels` は文字列の配列で指定してください。例: [\"A\", \"B\"]",
    );
  }

  const levels: unknown[] = (data as {levels: unknown[]}).levels;

  if (levels.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "`levels` に 1 つ以上のレベルを指定してください。",
    );
  }

  for (const level of levels) {
    if (typeof level !== "string" || !VALID_LEVELS.has(level)) {
      throw new HttpsError(
        "invalid-argument",
        `無効なレベル "${String(level)}" が含まれています。` +
          " 有効な値は A 〜 M です。",
      );
    }
  }

  // 重複レベルの除去
  const uniqueLevels = [...new Set(levels as string[])];

  // --- 問題データの取得（並列）---
  const rawQuestionsPerLevel = await Promise.all(
    uniqueLevels.map((level) => fetchQuizData(level)),
  );

  // --- プールの結合・シャッフル・先頭 20 問の抽出 ---
  const pool = rawQuestionsPerLevel.flat();

  if (pool.length < QUESTION_COUNT) {
    throw new HttpsError(
      "failed-precondition",
      "問題数が不足しています。" +
        ` 指定レベルの合計問題数: ${pool.length} / 必要数: ${QUESTION_COUNT}`,
    );
  }

  shuffleArray(pool);

  const questions: QuizQuestion[] = pool
    .slice(0, QUESTION_COUNT)
    .map((raw, index) => ({
      order: index + 1,
      id: raw.id,
      question: raw.question,
      answer_hash: hashAnswer(raw.answer),
    }));

  return {questions};
}
