/**
 * seed-emulator.mjs
 *
 * Firebase Storage エミュレーターに問題 JSON をアップロードするシードスクリプト。
 * エミュレーター起動後（just emulate）に別ターミナルで実行する。
 *
 *   just seed
 */

import { initializeApp } from "../functions/node_modules/firebase-admin/lib/esm/app/index.js";
import { getStorage } from "../functions/node_modules/firebase-admin/lib/esm/storage/index.js";
import { readdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Storage エミュレーターに向ける ────────────────────────────────────────
process.env["FIREBASE_STORAGE_EMULATOR_HOST"] = "127.0.0.1:9199";

// ─── 設定 ──────────────────────────────────────────────────────────────────
const __dirname  = dirname(fileURLToPath(import.meta.url));
const SEED_DIR   = join(__dirname, "../emulator-seed/quiz");
const BUCKET_NAME = "mumumu-a278.firebasestorage.app";

// ─── 初期化 ────────────────────────────────────────────────────────────────
initializeApp({ storageBucket: BUCKET_NAME });
const bucket = getStorage().bucket();

// ─── アップロード ──────────────────────────────────────────────────────────
const files     = await readdir(SEED_DIR);
const jsonFiles = files.filter((f) => f.endsWith(".json"));

if (jsonFiles.length === 0) {
  console.error("❌  emulator-seed/quiz/ に JSON ファイルが見つかりません。");
  process.exit(1);
}

for (const file of jsonFiles) {
  const localPath  = join(SEED_DIR, file);
  const remotePath = `quiz/${file}`;
  await bucket.upload(localPath, { destination: remotePath });
  console.log(`✅  Uploaded: ${remotePath}`);
}

console.log(`\n🎉  ${jsonFiles.length} ファイルをエミュレーターにアップロードしました。`);
console.log("    Emulator UI: http://localhost:4000/storage");
