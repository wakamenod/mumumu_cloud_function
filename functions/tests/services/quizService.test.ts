import {createHash} from "crypto";

// ---------------------------------------------------------------------------
// firebase-admin/storage のモック
// ---------------------------------------------------------------------------

const mockDownload = jest.fn();
const mockFile = jest.fn(() => ({download: mockDownload}));
const mockBucket = jest.fn(() => ({file: mockFile}));
const mockGetStorage = jest.fn(() => ({bucket: mockBucket}));

jest.mock("firebase-admin/storage", () => ({
  getStorage: mockGetStorage,
}));

// ---------------------------------------------------------------------------
// テスト対象（モック設定後に import）
// ---------------------------------------------------------------------------

import {
  fetchQuizData,
  hashAnswer,
  questionCache,
} from "../../src/services/quizService";

// ---------------------------------------------------------------------------
// テストデータ
// ---------------------------------------------------------------------------

const SAMPLE_QUESTIONS = [
  {id: "q001", question: "1 + 1 = ?", answer: "2"},
  {id: "q002", question: "2 + 3 = ?", answer: "5"},
];

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("hashAnswer", () => {
  it("SHA-256 の hex 文字列（64 文字）を返す", () => {
    const result = hashAnswer("12");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("Node.js crypto の結果と一致する", () => {
    const expected = createHash("sha256").update("12", "utf8").digest("hex");
    expect(hashAnswer("12")).toBe(expected);
  });

  it("異なる入力は異なるハッシュを返す", () => {
    expect(hashAnswer("1/2")).not.toBe(hashAnswer("2/4"));
  });
});

describe("fetchQuizData", () => {
  beforeEach(() => {
    questionCache.clear();
    mockDownload.mockReset();
    mockDownload.mockResolvedValue([
      Buffer.from(JSON.stringify(SAMPLE_QUESTIONS)),
    ]);
  });

  it("初回は Storage から取得してキャッシュに保存する", async () => {
    const result = await fetchQuizData("A");

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockFile).toHaveBeenCalledWith("quiz/A_v1.json");
    expect(result).toEqual(SAMPLE_QUESTIONS);
    expect(questionCache.has("A")).toBe(true);
  });

  it("2 回目以降はキャッシュを返す（Storage を叩かない）", async () => {
    await fetchQuizData("A");
    await fetchQuizData("A");
    await fetchQuizData("A");

    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it("キャッシュはインスタンスが生きている限り永続する（時間経過で破棄されない）", async () => {
    jest.useFakeTimers();
    await fetchQuizData("A");

    // 1 時間経過してもキャッシュが有効なことを確認
    jest.advanceTimersByTime(60 * 60 * 1000);
    await fetchQuizData("A");

    expect(mockDownload).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("異なるレベルはそれぞれ個別に取得・キャッシュする", async () => {
    await fetchQuizData("A");
    await fetchQuizData("B");

    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(mockFile).toHaveBeenCalledWith("quiz/A_v1.json");
    expect(mockFile).toHaveBeenCalledWith("quiz/B_v1.json");
  });
});
