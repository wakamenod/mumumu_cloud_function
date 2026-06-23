import {
  handleSubmitScore,
  handleRegisterUsername,
  handleGetRanking,
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
  getRanking: jest.fn(),
  RankingError: class RankingError extends Error {
    /**
     * @param {string} code - エラーコード
     * @param {string} message - エラーメッセージ
     */
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "RankingError";
    }
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
const {fetchQuizData: mockFetchQuizData} =
  require("../../src/services/quizService.js");
const {
  submitScore: mockSubmitScore,
  registerUsername: mockRegisterUsername,
  getRanking: mockGetRanking,
  RankingError: MockRankingError,
} = require("../../src/services/rankingService.js");
/* eslint-enable @typescript-eslint/no-require-imports */
/* eslint-enable @typescript-eslint/no-var-requires */

// ---------------------------------------------------------------------------
// テスト用定数
// ---------------------------------------------------------------------------

const QUESTION_COUNT = 7;
const VALID_LEVEL = "A";

/** 7 問分のダミー問題データ（answer は "correct_N" 形式） */
const dummyQuestions = Array.from({length: QUESTION_COUNT}, (_, i) => ({
  id: i + 1,
  question: `問題 ${i + 1}`,
  answer: `correct_${i}`,
}));

/** 全問正解の解答リスト（{ id: number; answer: string }[] 形式） */
const allCorrectAnswers = dummyQuestions.map((q) => ({
  id: q.id,
  answer: q.answer,
}));

/** startedAt: 60 秒前（正常な経過時間）*/
const validStartedAt = Date.now() - 60_000;

/** ランクインを示すデフォルトのモック戻り値 */
const rankedResult = {
  ranked: true,
  rank: 1,
  correct_count: 7,
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

  test("全問正解でランクインした場合、correct_count: 7 と claimToken を返す", async () => {
    const result = await handleSubmitScore({
      level: VALID_LEVEL,
      answers: allCorrectAnswers,
      startedAt: validStartedAt,
    });

    expect(result.ranked).toBe(true);
    expect(result.rank).toBe(1);
    expect(result.claimToken).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(mockSubmitScore).toHaveBeenCalledWith(
      VALID_LEVEL, 7, expect.any(Number),
    );
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
      answers: Array.from({length: QUESTION_COUNT}, (_, i) => ({
        id: i + 1, answer: "wrong_answer",
      })),
      startedAt: validStartedAt,
    });

    expect(result.ranked).toBe(false);
    expect(mockSubmitScore).toHaveBeenCalledWith(
      VALID_LEVEL, 0, expect.any(Number),
    );
  });

  test("部分正解のとき correct_count が正しく計算される", async () => {
    const partialAnswers = allCorrectAnswers.map((a, i) =>
      i % 2 === 0 ? a : {id: a.id, answer: "wrong"},
    ); // 偶数インデックスのみ正解 → 4 問正解

    await handleSubmitScore({
      level: VALID_LEVEL,
      answers: partialAnswers,
      startedAt: validStartedAt,
    });

    expect(mockSubmitScore).toHaveBeenCalledWith(
      VALID_LEVEL, 4, expect.any(Number),
    );
  });

  // --- invalid-argument: level ---

  test("level が未指定のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        answers: allCorrectAnswers, startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が無効な文字列のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: "Z", answers: allCorrectAnswers, startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が小文字のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: "a", answers: allCorrectAnswers, startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: answers ---

  test("answers が配列でないとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: "not-an-array",
        startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("answers が 7 件未満のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: VALID_LEVEL, answers: ["a"], startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("answers に不正な要素が含まれるとき invalid-argument を投げる", async () => {
    const badAnswers = [
      ...allCorrectAnswers.slice(1),
      {id: "not-a-number", answer: "wrong"} as unknown,
    ];

    await expect(
      handleSubmitScore({
        level: VALID_LEVEL, answers: badAnswers, startedAt: validStartedAt,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: startedAt ---

  test("startedAt が文字列のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: allCorrectAnswers,
        startedAt: "not-a-number",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("startedAt が Infinity のとき invalid-argument を投げる", async () => {
    await expect(
      handleSubmitScore({
        level: VALID_LEVEL,
        answers: allCorrectAnswers,
        startedAt: Infinity,
      }),
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
    // startedAt を 1 秒前に設定（7問 × 0.5秒 = 3.5秒が閾値）
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
      handleRegisterUsername({
        claimToken: VALID_TOKEN, username: VALID_USERNAME,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("level が無効のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: "Z", claimToken: VALID_TOKEN, username: VALID_USERNAME,
      }),
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
      handleRegisterUsername({
        level: VALID_LEVEL,
        claimToken: "not-a-uuid",
        username: VALID_USERNAME,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("claimToken が UUID v1 形式のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL,
        // eslint-disable-next-line max-len
        claimToken: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", // v1 UUID // gitleaks:allow
        username: VALID_USERNAME,
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  // --- invalid-argument: username ---

  test("username が 5 文字未満のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "HI",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username が 6 文字以上のとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "TOOLONG",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username に小文字が含まれるとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "Hello",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username にハイフン以外の記号が含まれるとき invalid-argument を投げる", async () => {
    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL, claimToken: VALID_TOKEN, username: "HE!LO",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  test("username にハイフンが含まれるとき正常に処理される", async () => {
    const result = await handleRegisterUsername({
      level: VALID_LEVEL,
      claimToken: VALID_TOKEN,
      username: "AB-CD",
    });

    expect(result.success).toBe(true);
    expect(mockRegisterUsername).toHaveBeenCalledWith(
      VALID_LEVEL,
      VALID_TOKEN,
      "AB-CD",
    );
  });

  // --- RankingError の伝播 ---

  test(
    "registerUsername が not-found を投げたとき" +
    " HttpsError(not-found) に変換される",
    async () => {
      mockRegisterUsername.mockRejectedValue(
        new MockRankingError("not-found", "Token not found"),
      );

      await expect(
        handleRegisterUsername({
          level: VALID_LEVEL,
          claimToken: VALID_TOKEN,
          username: VALID_USERNAME,
        }),
      ).rejects.toMatchObject({code: "not-found"});
    },
  );

  test(
    "registerUsername が deadline-exceeded を投げたとき" +
    " HttpsError(deadline-exceeded) に変換される",
    async () => {
      mockRegisterUsername.mockRejectedValue(
        new MockRankingError("deadline-exceeded", "TTL exceeded"),
      );

      await expect(
        handleRegisterUsername({
          level: VALID_LEVEL,
          claimToken: VALID_TOKEN,
          username: VALID_USERNAME,
        }),
      ).rejects.toMatchObject({code: "deadline-exceeded"});
    },
  );

  test("予期しない Error はそのまま再スローされる", async () => {
    mockRegisterUsername.mockRejectedValue(new Error("Unexpected"));

    await expect(
      handleRegisterUsername({
        level: VALID_LEVEL, claimToken: VALID_TOKEN, username: VALID_USERNAME,
      }),
    ).rejects.toThrow("Unexpected");
  });
});

// ---------------------------------------------------------------------------
// handleGetRanking テスト
// ---------------------------------------------------------------------------

/** ランキング表示用エントリのサンプル */
const sampleRankings = [
  {rank: 1, username: "BBBBB", correct_count: 7, elapsed_time: 30.1},
  {rank: 2, username: "CCCCC", correct_count: 7, elapsed_time: 35.2},
  {rank: 3, username: "DDDDD", correct_count: 18, elapsed_time: 52.4},
];

describe("handleGetRanking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRanking.mockResolvedValue({rankings: sampleRankings});
  });

  // --- 正常系 ---

  test("正常なリクエストで getRanking を呼び出しランキング一覧を返す", async () => {
    const result = await handleGetRanking({level: VALID_LEVEL});

    expect(result.rankings).toEqual(sampleRankings);
    expect(mockGetRanking).toHaveBeenCalledWith(VALID_LEVEL);
  });

  test("ドキュメント未存在時（空配列）も正常に返す", async () => {
    mockGetRanking.mockResolvedValue({rankings: []});

    const result = await handleGetRanking({level: VALID_LEVEL});

    expect(result.rankings).toEqual([]);
    expect(mockGetRanking).toHaveBeenCalledWith(VALID_LEVEL);
  });

  // --- invalid-argument: level ---

  test("level が未指定のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking({})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("level が空文字のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking({level: ""})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("level が無効な文字列（'Z'）のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking({level: "Z"})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("level が小文字（'a'）のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking({level: "a"})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("level が数値のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking({level: 1})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("data が null のとき invalid-argument を投げる", async () => {
    await expect(handleGetRanking(null)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});
