import {createHash} from "crypto";

// ---------------------------------------------------------------------------
// quizService のモック
// ---------------------------------------------------------------------------

const mockFetchQuizData = jest.fn();

jest.mock("../../src/services/quizService", () => ({
  fetchQuizData: mockFetchQuizData,
  hashAnswer: (answer: string) =>
    createHash("sha256").update(answer, "utf8").digest("hex"),
}));

// ---------------------------------------------------------------------------
// テスト対象（モック設定後に import）
// ---------------------------------------------------------------------------

import {handleGetQuiz} from "../../src/handlers/quizHandlers";

// ---------------------------------------------------------------------------
// テストデータ生成ヘルパー
// ---------------------------------------------------------------------------

/**
 * n 問分のダミー問題を生成する
 *
 * @param {number} n - 生成する問題数
 * @param {string} prefix - 問題 ID のプレフィックス
 * @return {object[]} ダミー問題の配列
 */
function makeQuestions(n: number, prefix = "Q") {
  return Array.from({length: n}, (_, i) => ({
    id: `${prefix.toLowerCase()}${String(i + 1).padStart(3, "0")}`,
    question: `${prefix}${i + 1} = ?`,
    answer: String(i + 1),
  }));
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("handleGetQuiz — 正常系", () => {
  beforeEach(() => {
    mockFetchQuizData.mockReset();
  });

  it("単一レベルで 20 問を返す", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(25, "A"));

    const result = await handleGetQuiz({levels: ["A"]});

    expect(result.questions).toHaveLength(20);
  });

  it("複数レベルの問題をマージして 20 問返す", async () => {
    mockFetchQuizData
      .mockResolvedValueOnce(makeQuestions(15, "A"))
      .mockResolvedValueOnce(makeQuestions(15, "B"));

    const result = await handleGetQuiz({levels: ["A", "B"]});

    expect(result.questions).toHaveLength(20);
    expect(mockFetchQuizData).toHaveBeenCalledTimes(2);
  });

  it("order は 1 始まりの連番になっている", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    const {questions} = await handleGetQuiz({levels: ["A"]});

    questions.forEach((q, i) => {
      expect(q.order).toBe(i + 1);
    });
  });

  it("answer_hash は SHA-256 の hex 文字列（64 文字）である", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    const {questions} = await handleGetQuiz({levels: ["A"]});

    for (const q of questions) {
      expect(q.answer_hash).toHaveLength(64);
      expect(q.answer_hash).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("レスポンスに生の answer フィールドが含まれない", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    const {questions} = await handleGetQuiz({levels: ["A"]});

    for (const q of questions) {
      expect(q).not.toHaveProperty("answer");
    }
  });

  it("id が Storage の値そのままレスポンスに含まれる", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    const {questions} = await handleGetQuiz({levels: ["A"]});

    for (const q of questions) {
      expect(q).toHaveProperty("id");
      expect(typeof q.id).toBe("string");
      expect(q.id.length).toBeGreaterThan(0);
    }
  });

  it("重複レベルは 1 回だけ取得する", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    await handleGetQuiz({levels: ["A", "A"]});

    expect(mockFetchQuizData).toHaveBeenCalledTimes(1);
  });

  it("Auth なし（request.auth なし相当）で正常に動作する", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "A"));

    // auth を一切渡さず data だけ渡しても動作することを確認
    await expect(handleGetQuiz({levels: ["A"]})).resolves.toBeDefined();
  });

  it("最大レベル M を指定しても正常に動作する", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "M"));

    const result = await handleGetQuiz({levels: ["M"]});

    expect(result.questions).toHaveLength(20);
  });

  it("全 13 レベル（A〜M）を同時指定しても正常に動作する", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(20, "Q"));

    const allLevels = [
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    ];
    const result = await handleGetQuiz({levels: allLevels});

    expect(result.questions).toHaveLength(20);
    expect(mockFetchQuizData).toHaveBeenCalledTimes(13);
  });
});

describe("handleGetQuiz — 異常系", () => {
  beforeEach(() => {
    mockFetchQuizData.mockReset();
  });

  it("levels が undefined のとき invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("levels が空配列のとき invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({levels: []})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("無効なレベル名 ('Z') のとき invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({levels: ["Z"]})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("'M' の次のレベル ('N') は invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({levels: ["N"]})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("小文字 ('a') のとき invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({levels: ["a"]})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("levels が文字列型でない要素を含む場合 invalid-argument を投げる", async () => {
    await expect(handleGetQuiz({levels: [1]})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("プール合計が 20 問未満のとき failed-precondition を投げる", async () => {
    mockFetchQuizData.mockResolvedValue(makeQuestions(10, "A"));

    await expect(handleGetQuiz({levels: ["A"]})).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });
});
