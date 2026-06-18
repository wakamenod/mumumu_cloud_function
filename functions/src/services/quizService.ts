import {createHash} from "crypto";
import {getStorage} from "firebase-admin/storage";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** Firebase Storage に保存された問題 JSON の 1 要素 */
export interface RawQuestion {
  id: string;
  question: string;
  answer: string;
}

/** Cloud Function がクライアントに返す 1 問分のデータ */
export interface QuizQuestion {
  order: number;
  id: string;
  question: string;
  answer_hash: string;
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** Storage 内の問題 JSON のパスプレフィックス */
const STORAGE_PATH_PREFIX = "quiz/";

/** ファイル名のバージョンサフィックス（キャッシュ破棄時にここを変更） */
const FILE_VERSION = "v1";

// ---------------------------------------------------------------------------
// キャッシュ（Cloud Functions インスタンスのメモリに保持）
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: RawQuestion[];
}

export const questionCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/**
 * 正解文字列を SHA-256 でハッシュ化して hex 文字列を返す。
 * 生の answer がレスポンスに含まれないよう、呼び出し側で answer を破棄すること。
 *
 * @param {string} answer - ハッシュ化する正解文字列
 * @return {string} SHA-256 の hex 文字列
 */
export function hashAnswer(answer: string): string {
  return createHash("sha256").update(answer, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Storage アクセス
// ---------------------------------------------------------------------------

/**
 * 指定レベルの問題データを Firebase Storage から取得する。
 * 同一インスタンス内ではキャッシュを利用し Storage への通信を最小化する（仕様 §6.3）。
 *
 * @param {string} level - "A" 〜 "M" のレベル識別子
 * @return {Promise<RawQuestion[]>} RawQuestion の配列（answer は生テキスト）
 */
export async function fetchQuizData(level: string): Promise<RawQuestion[]> {
  const cached = questionCache.get(level);

  if (cached) {
    return cached.data;
  }

  const filePath = `${STORAGE_PATH_PREFIX}${level}_${FILE_VERSION}.json`;
  const bucket = getStorage().bucket();
  const file = bucket.file(filePath);

  const [contents] = await file.download();
  const parsed = JSON.parse(contents.toString("utf8"));
  const data: RawQuestion[] = Array.isArray(parsed) ? parsed : parsed.questions;

  questionCache.set(level, {data});
  return data;
}
