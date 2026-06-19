import {
  submitScore,
  registerUsername,
  RankingError,
} from "../../src/services/rankingService.js";

// ---------------------------------------------------------------------------
// Firestore モック
// ---------------------------------------------------------------------------

const mockRunTransaction = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockSet = jest.fn();

jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");

  return {
    ...actual,
    getFirestore: jest.fn(() => ({
      collection: jest.fn(() => ({
        doc: jest.fn(() => "mockDocRef"),
      })),
      runTransaction: mockRunTransaction,
    })),
    Timestamp: {
      now: jest.fn(() => ({toMillis: () => 1718268420000})),
    },
    FieldValue: {
      serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP"),
    },
  };
});

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** Transaction コールバックを即時実行するモックを設定する */
function setupTransaction(
  exists: boolean,
  existingScores: unknown[] = [],
): void {
  mockGet.mockResolvedValue({
    exists,
    data: () => ({scores: existingScores}),
  });

  // Firestore SDK は runTransaction(updateFn) の形式（第1引数がコールバック）
  mockRunTransaction.mockImplementation(
    async (fn: (t: unknown) => Promise<void>) => {
      await fn({
        get: mockGet,
        update: mockUpdate,
        set: mockSet,
      });
    },
  );
}

/** ランキングエントリのファクトリ */
function makeEntry(
  correctCount: number,
  elapsedTime: number,
  createdAtMs = 1718268420000,
) {
  return {
    username: "AAAAA",
    correct_count: correctCount,
    elapsed_time: elapsedTime,
    created_at: {toMillis: () => createdAtMs},
    claim_token: null,
  };
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("submitScore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- 正常系: ランクイン ---

  test("ドキュメントが存在しない場合（初回）はランクインしてドキュメントを set する", async () => {
    setupTransaction(false, []);

    const result = await submitScore("A", 18, 52.4);

    expect(result.ranked).toBe(true);
    expect(result.rank).toBe(1);
    expect(result.correct_count).toBe(18);
    expect(result.elapsed_time).toBe(52.4);
    expect(result.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("スコアが 20 件未満の場合はランクインして update する", async () => {
    setupTransaction(true, [makeEntry(15, 60)]);

    const result = await submitScore("A", 18, 52.4);

    expect(result.ranked).toBe(true);
    expect(result.rank).toBe(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("新スコアが最下位より上位の場合はランクインする", async () => {
    const existing = Array.from({length: 20}, (_, i) =>
      makeEntry(10, 60 + i),
    );
    setupTransaction(true, existing);

    const result = await submitScore("A", 11, 55.0);

    expect(result.ranked).toBe(true);
    expect(result.rank).toBe(1);
  });

  // --- 正常系: 非ランクイン ---

  test("新スコアが 20 件すべてより下位の場合は ranked: false を返す", async () => {
    const existing = Array.from({length: 20}, (_, i) =>
      makeEntry(15, 50 + i),
    );
    setupTransaction(true, existing);

    const result = await submitScore("A", 5, 100.0);

    expect(result.ranked).toBe(false);
    expect(result.rank).toBeNull();
    expect(result.claimToken).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  // --- ソート・切り捨て ---

  test("ランクイン後に scores 配列が常に 20 件以内になる", async () => {
    const existing = Array.from({length: 20}, (_, i) =>
      makeEntry(10, 50 + i),
    );
    setupTransaction(true, existing);

    const result = await submitScore("A", 11, 45.0);

    expect(result.ranked).toBe(true);

    const calledScores = mockUpdate.mock.calls[0][1].scores as unknown[];
    expect(calledScores.length).toBeLessThanOrEqual(20);
  });

  test("correct_count 降順 → elapsed_time 昇順でソートされる", async () => {
    setupTransaction(true, [
      makeEntry(10, 60),
      makeEntry(12, 70),
      makeEntry(12, 50),
    ]);

    await submitScore("A", 11, 55.0);

    const calledScores = mockUpdate.mock.calls[0][1].scores as Array<{
      correct_count: number;
      elapsed_time: number;
    }>;

    expect(calledScores[0].correct_count).toBe(12);
    expect(calledScores[0].elapsed_time).toBe(50);
    expect(calledScores[1].correct_count).toBe(12);
    expect(calledScores[1].elapsed_time).toBe(70);
    expect(calledScores[2].correct_count).toBe(11);
  });

  // --- claimToken ---

  test("claimToken は UUID v4 形式である", async () => {
    setupTransaction(false, []);

    const result = await submitScore("A", 20, 30.0);

    expect(result.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("新エントリの username は '-----' で初期化される", async () => {
    setupTransaction(false, []);

    await submitScore("A", 20, 30.0);

    const calledScores = mockSet.mock.calls[0][1].scores as Array<{
      username: string;
    }>;
    expect(calledScores[0].username).toBe("-----");
  });

  // --- rankings ---

  test("ランクイン時、rankings に claim_token が含まれない", async () => {
    setupTransaction(true, [makeEntry(15, 60)]);

    const result = await submitScore("A", 18, 52.4);

    expect(result.rankings).toBeDefined();
    for (const entry of result.rankings) {
      expect(entry).not.toHaveProperty("claim_token");
    }
  });

  test("ランクイン時、rankings に 1 始まりの rank が付与される", async () => {
    setupTransaction(true, [makeEntry(15, 60), makeEntry(12, 70)]);

    const result = await submitScore("A", 18, 52.4);

    expect(result.rankings[0].rank).toBe(1);
    expect(result.rankings[1].rank).toBe(2);
    expect(result.rankings[2].rank).toBe(3);
  });

  test("ランクイン時、rankings に自分のエントリ（'-----'）が含まれる", async () => {
    setupTransaction(true, [makeEntry(15, 60)]);

    const result = await submitScore("A", 18, 52.4);

    // rank 1 に自分のエントリ（correct_count: 18）が入る
    const myEntry = result.rankings.find((e) => e.rank === result.rank);
    expect(myEntry?.username).toBe("-----");
    expect(myEntry?.correct_count).toBe(18);
  });

  test("非ランクイン時、rankings は既存のランキングデータを返す", async () => {
    const existing = Array.from({length: 20}, (_, i) =>
      makeEntry(15, 50 + i),
    );
    setupTransaction(true, existing);

    const result = await submitScore("A", 5, 100.0);

    expect(result.rankings).toHaveLength(20);
    expect(result.rankings[0].rank).toBe(1);
    expect(result.rankings[19].rank).toBe(20);
    for (const entry of result.rankings) {
      expect(entry).not.toHaveProperty("claim_token");
    }
  });

  test("ドキュメントが存在しない初回ランクイン時、rankings は新エントリ 1 件を返す", async () => {
    setupTransaction(false, []);

    const result = await submitScore("A", 20, 30.0);

    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].rank).toBe(1);
    expect(result.rankings[0].username).toBe("-----");
  });
});

// ---------------------------------------------------------------------------
// registerUsername テスト
// ---------------------------------------------------------------------------

const VALID_TOKEN = "550e8400-e29b-41d4-a716-446655440000";
const RECENT_MS = Date.now() - 60_000; // 1 分前（TTL 内）
const EXPIRED_MS = Date.now() - 11 * 60 * 1000; // 11 分前（TTL 超過）

/** claim_token 付きエントリのファクトリ */
function makeEntryWithToken(
  claimToken: string | null,
  createdAtMs = RECENT_MS,
) {
  return {
    username: "-----",
    correct_count: 18,
    elapsed_time: 52.4,
    created_at: {toMillis: () => createdAtMs},
    claim_token: claimToken,
  };
}

describe("registerUsername", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- 正常系 ---

  test("claimToken が一致するエントリの username を更新して rank を返す", async () => {
    setupTransaction(true, [makeEntryWithToken(VALID_TOKEN)]);

    const result = await registerUsername("A", VALID_TOKEN, "HELLO");

    expect(result.success).toBe(true);
    expect(result.rank).toBe(1);
    expect(result.username).toBe("HELLO");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test("複数エントリ中の正しいエントリだけ更新される", async () => {
    const OTHER_TOKEN = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // gitleaks:allow
    setupTransaction(true, [
      makeEntryWithToken(OTHER_TOKEN),
      makeEntryWithToken(VALID_TOKEN),
    ]);

    const result = await registerUsername("A", VALID_TOKEN, "WORLD");

    expect(result.rank).toBe(2);
    const updatedScores = mockUpdate.mock.calls[0][1]
      .scores as Array<{username: string; claim_token: string | null}>;
    expect(updatedScores[0].username).toBe("-----"); // 変更なし
    expect(updatedScores[1].username).toBe("WORLD"); // 更新
  });

  test("username 登録後に claim_token が null になる（単一利用保証）", async () => {
    setupTransaction(true, [makeEntryWithToken(VALID_TOKEN)]);

    await registerUsername("A", VALID_TOKEN, "HELLO");

    const updatedScores = mockUpdate.mock.calls[0][1]
      .scores as Array<{claim_token: string | null}>;
    expect(updatedScores[0].claim_token).toBeNull();
  });

  // --- not-found ---

  test("claimToken が一致するエントリがない場合は RankingError(not-found) を投げる", async () => {
    setupTransaction(true, [makeEntryWithToken("different-token-xxxx")]);

    await expect(
      registerUsername("A", VALID_TOKEN, "HELLO"),
    ).rejects.toMatchObject({
      name: "RankingError",
      code: "not-found",
    });
  });

  test("claim_token が null（既使用）のエントリは not-found を投げる", async () => {
    setupTransaction(true, [makeEntryWithToken(null)]);

    await expect(
      registerUsername("A", VALID_TOKEN, "HELLO"),
    ).rejects.toMatchObject({
      name: "RankingError",
      code: "not-found",
    });
  });

  test("ドキュメントが存在しない場合は not-found を投げる", async () => {
    setupTransaction(false, []);

    await expect(
      registerUsername("A", VALID_TOKEN, "HELLO"),
    ).rejects.toMatchObject({
      name: "RankingError",
      code: "not-found",
    });
  });

  // --- deadline-exceeded ---

  test("TTL（10分）を超過した claimToken は deadline-exceeded を投げる", async () => {
    setupTransaction(true, [makeEntryWithToken(VALID_TOKEN, EXPIRED_MS)]);

    await expect(
      registerUsername("A", VALID_TOKEN, "HELLO"),
    ).rejects.toMatchObject({
      name: "RankingError",
      code: "deadline-exceeded",
    });

    // TTL 超過時は書き込みを行わない
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // --- エラー型確認 ---

  test("RankingError は Error のインスタンスである", async () => {
    setupTransaction(true, [makeEntryWithToken("no-match")]);

    let caught: unknown;
    try {
      await registerUsername("A", VALID_TOKEN, "HELLO");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(RankingError);
    expect(caught).toBeInstanceOf(Error);
  });
});
