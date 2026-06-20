import {randomUUID} from "crypto";
import {getFirestore, FieldValue, Timestamp} from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** scores 配列の 1 エントリ（Firestore に保存される形式） */
export interface RankingEntry {
  username: string;
  correct_count: number;
  elapsed_time: number;
  created_at: Timestamp;
  claim_token: string | null;
}

/** クライアントに返すランキング表示用エントリ（claim_token を除外済み） */
export interface RankingDisplayEntry {
  rank: number;
  username: string;
  correct_count: number;
  elapsed_time: number;
}

/** submitScore の戻り値 */
export interface SubmitScoreResult {
  ranked: boolean;
  rank: number | null;
  correct_count: number;
  elapsed_time: number;
  claimToken: string | null;
  rankings: RankingDisplayEntry[];
}

/** registerUsername の戻り値 */
export interface RegisterUsernameResult {
  success: boolean;
  rank: number;
  username: string;
}

/** getRanking の戻り値 */
export interface GetRankingResult {
  rankings: RankingDisplayEntry[];
}

/**
 * ランキング操作で発生するドメインエラー。
 * ハンドラー側で HttpsError に変換する。
 */
export class RankingError extends Error {
  /**
   * @param {"not-found" | "deadline-exceeded"} code - エラーコード
   * @param {string} message - エラーメッセージ
   */
  constructor(
    public readonly code: "not-found" | "deadline-exceeded",
    message: string,
  ) {
    super(message);
    this.name = "RankingError";
  }
}

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** ランキング上位何位まで保持するか */
const RANKING_LIMIT = 20;

/** username の初期値（ユーザー名登録前のプレースホルダー） */
const USERNAME_PLACEHOLDER = "-----";

/** claimToken の有効期限（ミリ秒）*/
const CLAIM_TOKEN_TTL_MS = 10 * 60 * 1000; // 10分

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/**
 * 2 つのエントリを比較する。
 * ソート基準: correct_count 降順 → elapsed_time 昇順 → created_at 昇順（先着優先）
 */
/**
 * @param {RankingEntry} a - 比較対象エントリ A
 * @param {RankingEntry} b - 比較対象エントリ B
 * @return {number} ソート順を示す数値
 */
function compareEntries(a: RankingEntry, b: RankingEntry): number {
  if (b.correct_count !== a.correct_count) {
    return b.correct_count - a.correct_count;
  }
  if (a.elapsed_time !== b.elapsed_time) {
    return a.elapsed_time - b.elapsed_time;
  }
  return a.created_at.toMillis() - b.created_at.toMillis();
}

/**
 * 新スコアが現在の 20 位（最下位エントリ）より上位かどうかを判定する。
 * scores が 20 件未満の場合は常に true を返す。
 */
/**
 * @param {RankingEntry[]} scores - 現在のスコア配列
 * @param {RankingEntry} newEntry - 新規エントリ
 * @return {boolean} ランクインするかどうか
 */
function shouldRankIn(
  scores: RankingEntry[],
  newEntry: RankingEntry,
): boolean {
  if (scores.length < RANKING_LIMIT) return true;
  const last = scores[scores.length - 1];
  return compareEntries(newEntry, last) < 0;
}

/**
 * RankingEntry の配列を RankingDisplayEntry の配列に変換する。
 * claim_token を除外し、1 始まりの rank を付与する。
 */
/**
 * @param {RankingEntry[]} scores - 変換対象のスコア配列
 * @return {RankingDisplayEntry[]} 表示用エントリ配列
 */
function toDisplayEntries(scores: RankingEntry[]): RankingDisplayEntry[] {
  return scores.map((entry, index) => ({
    rank: index + 1,
    username: entry.username,
    correct_count: entry.correct_count,
    elapsed_time: entry.elapsed_time,
  }));
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

/**
 * スコアを Firestore のランキングに仮登録する。
 *
 * Firestore Transaction で /rankings/level_{level} を read し、
 * ランクインする場合は claimToken を生成して username: "-----" で仮登録する。
 * 競合時は Firestore が自動リトライするため整合性が保証される。
 * rankings は Transaction の read で取得したデータをそのまま返すため
 * 追加の Firestore read は発生しない。
 *
 * @param {string} level - レベル識別子（A〜M）
 * @param {number} correctCount - サーバー側で算出した正解数
 * @param {number} elapsedTime - サーバー側で算出した経過時間（秒）
 * @return {Promise<SubmitScoreResult>} ランクイン結果・claimToken・最新ランキング
 */
/**
 * claimToken を検証し、ランキングエントリにユーザー名を本登録する。
 *
 * Firestore Transaction で /rankings/level_{level} を read し、
 * claimToken が一致するエントリを探して username を上書き・claim_token を null にする。
 * 同じ claimToken での二重登録は claim_token: null への書き換え後に not-found となり防止される。
 *
 * @param {string} level - レベル識別子（A〜M）
 * @param {string} claimToken - submitScoreFunction が返した UUID v4
 * @param {string} username - 登録するユーザー名（5文字・英大文字）
 * @return {Promise<RegisterUsernameResult>} 登録結果と確定順位
 * @throws {RankingError} not-found / deadline-exceeded
 */
export async function registerUsername(
  level: string,
  claimToken: string,
  username: string,
): Promise<RegisterUsernameResult> {
  const db = getFirestore();
  const docRef = db.collection("rankings").doc(`level_${level}`);

  let result: RegisterUsernameResult = {success: false, rank: 0, username};

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    const scores: RankingEntry[] = snapshot.exists ?
      (snapshot.data()?.scores ?? []) :
      [];

    // claimToken が一致するエントリを検索
    const entryIndex = scores.findIndex(
      (e) => e.claim_token === claimToken,
    );

    if (entryIndex === -1) {
      throw new RankingError(
        "not-found",
        "claimToken に一致するエントリが見つかりません。無効・既使用・期限切れの可能性があります。",
      );
    }

    // TTL チェック（created_at から 10 分以内か）
    const entry = scores[entryIndex];
    const elapsedMs = Date.now() - entry.created_at.toMillis();

    if (elapsedMs > CLAIM_TOKEN_TTL_MS) {
      throw new RankingError(
        "deadline-exceeded",
        `claimToken の有効期限（10分）を超過しています（経過: ${Math.floor(elapsedMs / 1000)} 秒）。`,
      );
    }

    // username を上書き・claim_token を null にして単一利用を保証
    const updated = scores.map((e, i) =>
      i === entryIndex ?
        {...e, username, claim_token: null} :
        e,
    );

    transaction.update(docRef, {scores: updated});

    const rank = entryIndex + 1;
    result = {success: true, rank, username};
  });

  return result;
}

/**
 * 指定レベルのランキング一覧を取得する。
 *
 * Firestore の /rankings/level_{level} を単純 read し、
 * claim_token を除外した表示用エントリ配列を返す。
 * ドキュメントが存在しない場合は空配列を返す（エラーにしない）。
 *
 * @param {string} level - レベル識別子（A〜M）
 * @return {Promise<GetRankingResult>} 最新の上位 20 件（claim_token 除外済み）
 */
export async function getRanking(level: string): Promise<GetRankingResult> {
  const db = getFirestore();
  const docRef = db.collection("rankings").doc(`level_${level}`);
  const snapshot = await docRef.get();

  const scores: RankingEntry[] = snapshot.exists ?
    (snapshot.data()?.scores ?? []) :
    [];

  return {rankings: toDisplayEntries(scores)};
}

/**
 * スコアを Firestore のランキングに仮登録する。
 *
 * @param {string} level - レベル識別子（A〜M）
 * @param {number} correctCount - サーバー側で算出した正解数
 * @param {number} elapsedTime - サーバー側で算出した経過時間（秒）
 * @return {Promise<SubmitScoreResult>} ランクイン結果・claimToken・最新ランキング
 */
export async function submitScore(
  level: string,
  correctCount: number,
  elapsedTime: number,
): Promise<SubmitScoreResult> {
  const db = getFirestore();
  const docRef = db.collection("rankings").doc(`level_${level}`);

  let result: SubmitScoreResult = {
    ranked: false,
    rank: null,
    correct_count: correctCount,
    elapsed_time: elapsedTime,
    claimToken: null,
    rankings: [],
  };

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    // 既存スコア配列を取得（ドキュメントが存在しない場合は空配列）
    const existing: RankingEntry[] = snapshot.exists ?
      (snapshot.data()?.scores ?? []) :
      [];

    const now = Timestamp.now();
    const claimToken = randomUUID();

    const newEntry: RankingEntry = {
      username: USERNAME_PLACEHOLDER,
      correct_count: correctCount,
      elapsed_time: elapsedTime,
      created_at: now,
      claim_token: claimToken,
    };

    if (!shouldRankIn(existing, newEntry)) {
      // ランクインしない場合は書き込みをスキップし、現在のランキングのみ返す
      result = {
        ranked: false,
        rank: null,
        correct_count: correctCount,
        elapsed_time: elapsedTime,
        claimToken: null,
        rankings: toDisplayEntries(existing),
      };
      return;
    }

    // ランクイン: 配列に追加→ソート→上位 RANKING_LIMIT 件に切り捨て
    const updated = [...existing, newEntry]
      .sort(compareEntries)
      .slice(0, RANKING_LIMIT);

    // ドキュメントが存在しない場合は set、存在する場合は update
    if (snapshot.exists) {
      transaction.update(docRef, {scores: updated});
    } else {
      transaction.set(docRef, {
        scores: updated,
        updated_at: FieldValue.serverTimestamp(),
      });
    }

    const rank = updated.findIndex(
      (entry) => entry.claim_token === claimToken,
    ) + 1;

    result = {
      ranked: true,
      rank,
      correct_count: correctCount,
      elapsed_time: elapsedTime,
      claimToken,
      rankings: toDisplayEntries(updated),
    };
  });

  return result;
}
