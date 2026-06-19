import {
  handleSubmitScore,
  handleRegisterUsername,
} from "../../src/handlers/rankingHandlers.js";

// ---------------------------------------------------------------------------
// モック
// ---------------------------------------------------------------------------

// jest.mock のファクトリは巻き上げ（hoisting）されるため const 変数を参照できない。
// jest.fn() をファクトリ内で定義し、後から jest.mocked() 経由で参照する。
jest.mock("../../src/services/quizService.js", () => ({
  fetchQuizData: jest.fn(),
}));

jest.mock("../../src/services/rankingService.js", () => ({
  submitScore: jest.fn(),
  registerUsername: jest.fn(),
  RankingError: class RankingError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "RankingError";
    }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {fetchQuizData: mockFetchQuizData} = require("../../src/services/quizService.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  submitScore: mockSubmitScore,
  registerUsername: mockRegisterUsername,
  RankingError: MockRankingError,
} = require("../../src/services/rankingService.js");

// ---------------------------------------------------------------------------
// テスト用定数
// ---------------------------------------------------------------------------

const QUESTION_COUNT = 20;
const VALID_LEVEL = "A";

/** 20 問分のダミー問題データ（answer は "correct_N" 形式） */
const dummyQuestions = Array.from({length: QUESTION_COUNT}, (_, i) => ({
  id: `q${i + 1}`,
  question: `問題 ${i + 1}`,
  answer: `correct_${i}`,
}));

/** 全問正解の解答リスト */
const allCorrectAnswers = dummyQuestions.map((q) => q.answer);

/** startedAt: 60 秒前（正常な経過時間）*/
const validStartedAt = Date.now() - 60_000;

/** ランクインを示すデフォルトのモック戻り値 */
const rankedResult = {
  ranked: true,
  rank: 1,
  correct_count: 20,
  elapsed_time: 60.0,
  claimToken: "550e8400-e29b-41d4-a716-446655440000",
};

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("handleSubmitScore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchQuizData.mockResolvedValue(dummyQuestions);
    mockSubmitScore.mockResolvedValue(rankedResult);
  });

  // --- 正常系 ---

  test("全問正解でランクインした場合、correct_count: 20 と claimToken を返す", async () => {
    const result = await handleSubmitScore({
      level: VALID_LEVEL,
      answers: allCorrectAnswers,
      startedAt: validStartedAt,
    });

    expect(result.ranked).toBe(true);
    expect(result.rank).toBe(1);
    expect(result.claimToken).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(mockSubmitScore).toHaveBeenCalledWith(VALID_LEVEL, 20, expect.any(Number));
  });

  test("全問不正解でも handleSubmitScore 自体はエラーにならない", async () => {
    mockSubmitScore.mockResolvedValue({
      ranked: false,
      rank: null,
      correct_count: 0,
      elapsed_time: 60.0,
      claimToken: null,
    });

    const result = await handleSubmitScore({
      level: VALID_LEVEL,
      answers: Array(QUESTION_COUNT).fill("wrong_answer"),
      startedAt: validStartedAt,
    });

    expect(result.ranked).toBe(false);
    expect(mockSubmitScore).toHaveBeenCalledWith(VALID_LEVEL, 0, expect.any(Number));
  });

  test("部分正解のとき correct_count が正しく計算される", async () => {
    const partialAnswers = allCorrectAnswers.map((a, i) =>
      i % 2 === 0 ? a : "wrong",
    ); // 偶数インデックスのみ正解 → 10 問正解

    await handleSubmitScore({
      level: VALID_LEVEL,
      answers: partialAnswers,
      startedAt: validStartedAt,
    });

    expect(mockSubmitScore).toHaveBeenCalledWith(VALID_LEVEL, 10, expect.any(Number));
  });

  // --- invalid-argument: level ---

  test("level が未指定のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({answers: allCorrectAnswers, startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が無効な文字列のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: "Z", answers: allCorrectAnswers, startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が小文字のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: "a", answers: allCorrectAnswers, startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: answers ---

  test("answers が配列でないとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: VALID_LEVEL, answers: "not-an-array", startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("answers が 20 件未満のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: VALID_LEVEL, answers: ["a"], startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("answers に文字列以外が含まれるとき invalid-argument を投げる", async () => {
    const badAnswers = [...allCorrectAnswers];
    badAnswers[0] = 123 as unknown as string;

    await expect(
      handleSubmitScore({level: VALID_LEVEL, answers: badAnswers, startedAt: validStartedAt}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: startedAt ---

  test("startedAt が文字列のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: VALID_LEVEL, answers: allCorrectAnswers, startedAt: "not-a-number"}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("startedAt が Infinity のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({level: VALID_LEVEL, answers: allCorrectAnswers, startedAt: Infinity}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- deadline-exceeded ---

  test("elapsed_time が異常に短いとき deadline-exceeded を投げる", async () => {
    // startedAt を現在時刻より未来に設定 → elapsed_time が負になる
    const futureStartedAt = Date.now() + 60_000;

    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: allCorrectAnswers,
        startedAt: futureStartedAt,
      }),
    ).rejects.toMatchObject({code: "deadline-exceeded"});
  });

  test("elapsed_time が閾値(10秒)未満のとき deadline-exceeded を投げる", async () => {
    // startedAt を 1 秒前に設定（20問 × 0.5秒 = 10秒が閾値）
    const tooRecentStartedAt = Date.now() - 1_000;

    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: allCorrectAnswers,
        startedAt: tooRecentStartedAt,
      }),
    ).rejects.toMatchObject({code: "deadline-exceeded"});
  });

  // --- not-found ---

  test("fetchQuizData が失敗したとき not-found を投げる", async () => {
    mockFetchQuizData.mockRejectedValue(new Error("Storage error"));

    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: allCorrectAnswers,
        startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "not-found"});
  });
});

// ---------------------------------------------------------------------------
// handleRegisterUsername テスト
// ---------------------------------------------------------------------------

const VALID_TOKEN = "550e8400-e29b-41d4-a716-446655440000";
const VALID_USERNAME = "HELLO";

describe("handleRegisterUsername", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisterUsername.mockResolvedValue({
      success: true,
      rank: 3,
      username: VALID_USERNAME,
    });
  });

  // --- 正常系 ---

  test("正常なリクエストで registerUsername を呼び出し結果を返す", async () => {
    const result = await handleRegisterUsername({
      level: VALID_LEVEL,
      claimToken: VALID_TOKEN,
      username: VALID_USERNAME,
    });

    expect(result.success).toBe(true);
    expect(result.rank).toBe(3);
    expect(result.username).toBe(VALID_USERNAME);
    expect(mockRegisterUsername).toHaveBeenCalledWith(
      VALID_LEVEL,
      VALID_TOKEN,
      VALID_USERNAME,
    );
  });

  // --- invalid-argument: level ---

  test("level が未指定のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({claimToken: VALID_TOKEN, username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が無効のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: "Z", claimToken: VALID_TOKEN, username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: claimToken ---

  test("claimToken が未指定のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("claimToken が UUID v4 形式でないとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: "not-a-uuid", username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("claimToken が UUID v1 形式のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL,
        claimToken: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", // v1 // gitleaks:allow
        username: VALID_USERNAME,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: username ---

  test("username が 5 文字未満のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "HI"}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username が 6 文字以上のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "TOOLONG"}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username に小文字が含まれるとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "Hello"}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username に記号が含まれるとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "HE!LO"}),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- RankingError の伝播 ---

  test("registerUsername が not-found を投げたとき HttpsError(not-found) に変換される", async () => {
    mockRegisterUsername.mockRejectedValue(
      new MockRankingError("not-found", "Token not found"),
    );

    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "not-found"});
  });

  test("registerUsername が deadline-exceeded を投げたとき HttpsError(deadline-exceeded) に変換される", async () => {
    mockRegisterUsername.mockRejectedValue(
      new MockRankingError("deadline-exceeded", "TTL exceeded"),
    );

    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: VALID_USERNAME}),
    ).rejects.toMatchObject({code: "deadline-exceeded"});
  });

  test("予期しない Error はそのまま再スローされる", async () => {
    mockRegisterUsername.mockRejectedValue(new Error("Unexpected"));

    await expect(
      handleRegisterUsername({level: VALID_LEVEL, claimToken: VALID_TOKEN, username: VALID_USERNAME}),
    ).rejects.toThrow("Unexpected");
  });
});
