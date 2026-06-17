import {createUser, getUserById} from "../../src/services/userService";

// -------------------------------------------------------------------
// firebase-admin モック
// jest.mock はホイストされるため、ファクトリ内で jest.fn() を直接定義する
// -------------------------------------------------------------------
jest.mock("firebase-admin", () => {
  const mockSet = jest.fn().mockResolvedValue(undefined);
  const mockGet = jest.fn();
  const mockDocRef = {set: mockSet, get: mockGet};
  const mockDoc = jest.fn().mockReturnValue(mockDocRef);
  const mockCollection = jest.fn().mockReturnValue({doc: mockDoc});

  const firestoreFn = jest.fn().mockReturnValue({collection: mockCollection});
  (firestoreFn as jest.MockedFunction<typeof firestoreFn> & {
    Timestamp: {now: jest.Mock};
  }).Timestamp = {
    now: jest.fn().mockReturnValue({seconds: 1700000000, nanoseconds: 0}),
  };

  return {
    initializeApp: jest.fn(),
    firestore: firestoreFn,
  };
});

// モック済みの admin から doc の参照を取得するヘルパー
function getMockDocRef() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const admin = require("firebase-admin");
  const db = admin.firestore();
  return db.collection("users").doc("any");
}

// -------------------------------------------------------------------
// createUser
// -------------------------------------------------------------------
describe("createUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMockDocRef().set.mockResolvedValue(undefined);
  });

  it("正常系: Firestore にユーザードキュメントを保存し、AppUser を返す", async () => {
    const uid = "user-001";
    const data = {displayName: "テストユーザー", email: "test@example.com"};

    const result = await createUser(uid, data);

    expect(result.uid).toBe(uid);
    expect(result.displayName).toBe(data.displayName);
    expect(result.email).toBe(data.email);
    expect(result.createdAt).toBeDefined();
  });

  it("正常系: Firestore の set() が一度だけ呼ばれる", async () => {
    await createUser("user-002", {
      displayName: "別ユーザー",
      email: "other@example.com",
    });

    expect(getMockDocRef().set).toHaveBeenCalledTimes(1);
  });

  it("正常系: set() に渡されるデータに uid が含まれる", async () => {
    const uid = "user-003";
    await createUser(uid, {displayName: "確認ユーザー", email: "check@example.com"});

    expect(getMockDocRef().set).toHaveBeenCalledWith(
      expect.objectContaining({uid})
    );
  });

  it("異常系: Firestore の set() が失敗した場合、エラーを伝播する", async () => {
    getMockDocRef().set.mockRejectedValue(new Error("Firestore write error"));

    await expect(
      createUser("user-err", {
        displayName: "失敗ユーザー",
        email: "fail@example.com",
      })
    ).rejects.toThrow("Firestore write error");
  });
});

// -------------------------------------------------------------------
// getUserById
// -------------------------------------------------------------------
describe("getUserById", () => {
  const mockUser = {
    uid: "user-001",
    displayName: "テストユーザー",
    email: "test@example.com",
    createdAt: {seconds: 1700000000, nanoseconds: 0},
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("正常系: ドキュメントが存在する場合、AppUser を返す", async () => {
    getMockDocRef().get.mockResolvedValue({exists: true, data: () => mockUser});

    const result = await getUserById("user-001");

    expect(result).toEqual(mockUser);
  });

  it("正常系: ドキュメントが存在しない場合、null を返す", async () => {
    getMockDocRef().get.mockResolvedValue({
      exists: false,
      data: () => undefined,
    });

    const result = await getUserById("nonexistent");

    expect(result).toBeNull();
  });

  it("異常系: Firestore の get() が失敗した場合、エラーを伝播する", async () => {
    getMockDocRef().get.mockRejectedValue(new Error("Firestore read error"));

    await expect(getUserById("user-err")).rejects.toThrow("Firestore read error");
  });
});
