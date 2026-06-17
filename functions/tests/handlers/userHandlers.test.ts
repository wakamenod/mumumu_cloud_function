import {handleCreateUser, handleGetUser, CallableAuth} from "../../src/handlers/userHandlers";
import * as userService from "../../src/services/userService";

// -------------------------------------------------------------------
// 依存モジュールのモック
// -------------------------------------------------------------------
jest.mock("../../src/services/userService");
jest.mock("firebase-functions/logger", () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock("firebase-functions/v2/https", () => ({
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "HttpsError";
    }
  },
}));

const mockCreateUser = userService.createUser as jest.MockedFunction<
  typeof userService.createUser
>;
const mockGetUserById = userService.getUserById as jest.MockedFunction<
  typeof userService.getUserById
>;

const validAuth: CallableAuth = {uid: "uid-001", token: {}};
const mockUser = {
  uid: "uid-001",
  displayName: "テストユーザー",
  email: "test@example.com",
  createdAt: {} as FirebaseFirestore.Timestamp,
};

// -------------------------------------------------------------------
// handleCreateUser
// -------------------------------------------------------------------
describe("handleCreateUser", () => {
  beforeEach(() => jest.clearAllMocks());

  it("正常系: 有効なデータでユーザーを作成して返す", async () => {
    mockCreateUser.mockResolvedValue(mockUser);

    const result = await handleCreateUser(validAuth, {
      displayName: "テストユーザー",
      email: "test@example.com",
    });

    expect(mockCreateUser).toHaveBeenCalledWith("uid-001", {
      displayName: "テストユーザー",
      email: "test@example.com",
    });
    expect(result).toEqual({user: mockUser});
  });

  it("正常系: displayName の前後の空白はトリミングされる", async () => {
    mockCreateUser.mockResolvedValue(mockUser);

    await handleCreateUser(validAuth, {
      displayName: "  テストユーザー  ",
      email: "test@example.com",
    });

    expect(mockCreateUser).toHaveBeenCalledWith("uid-001", {
      displayName: "テストユーザー",
      email: "test@example.com",
    });
  });

  it("異常系: auth が undefined の場合、unauthenticated エラーを投げる", async () => {
    await expect(
      handleCreateUser(undefined, {displayName: "テスト", email: "test@example.com"})
    ).rejects.toMatchObject({code: "unauthenticated"});

    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("異常系: displayName が空文字の場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleCreateUser(validAuth, {displayName: "", email: "test@example.com"})
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("異常系: displayName がスペースのみの場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleCreateUser(validAuth, {displayName: "   ", email: "test@example.com"})
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("異常系: email に @ がない場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleCreateUser(validAuth, {displayName: "テスト", email: "not-an-email"})
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("異常系: data が undefined の場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleCreateUser(validAuth, undefined)
    ).rejects.toMatchObject({code: "invalid-argument"});
  });
});

// -------------------------------------------------------------------
// handleGetUser
// -------------------------------------------------------------------
describe("handleGetUser", () => {
  beforeEach(() => jest.clearAllMocks());

  it("正常系: 存在するユーザーを返す", async () => {
    mockGetUserById.mockResolvedValue(mockUser);

    const result = await handleGetUser(validAuth, {uid: "uid-001"});

    expect(mockGetUserById).toHaveBeenCalledWith("uid-001");
    expect(result).toEqual({user: mockUser});
  });

  it("異常系: auth が undefined の場合、unauthenticated エラーを投げる", async () => {
    await expect(
      handleGetUser(undefined, {uid: "uid-001"})
    ).rejects.toMatchObject({code: "unauthenticated"});
  });

  it("異常系: uid が空文字の場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleGetUser(validAuth, {uid: ""})
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("異常系: uid が未指定の場合、invalid-argument エラーを投げる", async () => {
    await expect(
      handleGetUser(validAuth, {})
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("異常系: ユーザーが存在しない場合、not-found エラーを投げる", async () => {
    mockGetUserById.mockResolvedValue(null);

    await expect(
      handleGetUser(validAuth, {uid: "nonexistent"})
    ).rejects.toMatchObject({code: "not-found"});
  });

  it("異常系: Firestore がエラーを返した場合、エラーを伝播する", async () => {
    mockGetUserById.mockRejectedValue(new Error("Firestore error"));

    await expect(
      handleGetUser(validAuth, {uid: "uid-001"})
    ).rejects.toThrow("Firestore error");
  });
});
