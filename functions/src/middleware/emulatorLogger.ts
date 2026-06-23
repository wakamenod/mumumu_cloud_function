/**
 * エミュレータ実行時のみ、リクエスト/レスポンスを自動ログ出力するミドルウェア。
 * 本番環境ではオーバーヘッドゼロ（元のハンドラーをそのまま返す）。
 */
import * as logger from "firebase-functions/logger";
import type {Request} from "firebase-functions/https";
import type {Response} from "express";

const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

// ────────────────────────────────────────────
// onCall 用ラッパー
// ────────────────────────────────────────────

/**
 * onCall ハンドラーをラップし、エミュレータ実行時のみ
 * リクエストデータ・レスポンスデータ・処理時間をログ出力する。
 *
 * @param {string} name  関数名（ログ表示用）
 * @param {Function} handler  元の onCall ハンドラー
 * @return {Function} ラップされたハンドラー
 */
export function withEmulatorLogging<TData, TResult>(
  name: string,
  handler: (data: TData) => Promise<TResult>,
): (data: TData) => Promise<TResult> {
  // 本番では元のハンドラーをそのまま返す（ラップコストゼロ）
  if (!isEmulator) return handler;

  return async (data: TData): Promise<TResult> => {
    const start = Date.now();

    logger.info(`⚡ [${name}] >>> Request`, {
      function: name,
      requestData: data,
    });

    try {
      const result = await handler(data);
      const elapsed = Date.now() - start;

      logger.info(`✅ [${name}] <<< Response (${elapsed}ms)`, {
        function: name,
        responseData: result,
        elapsedMs: elapsed,
      });

      return result;
    } catch (error: unknown) {
      const elapsed = Date.now() - start;

      logger.error(`❌ [${name}] <<< Error (${elapsed}ms)`, {
        function: name,
        error: error instanceof Error ?
          {name: error.name, message: error.message, stack: error.stack} :
          error,
        elapsedMs: elapsed,
      });

      throw error; // 元のエラーをそのまま再送出
    }
  };
}

// ────────────────────────────────────────────
// onRequest 用ラッパー
// ────────────────────────────────────────────

type RequestHandler = (req: Request, res: Response) => void | Promise<void>;

/**
 * onRequest ハンドラーをラップし、エミュレータ実行時のみ
 * リクエスト情報・レスポンスステータス・処理時間をログ出力する。
 *
 * @param {string} name  関数名（ログ表示用）
 * @param {RequestHandler} handler  元の onRequest ハンドラー
 * @return {RequestHandler} ラップされたハンドラー
 */
export function withEmulatorRequestLogging(
  name: string,
  handler: RequestHandler,
): RequestHandler {
  if (!isEmulator) return handler;

  return async (req: Request, res: Response): Promise<void> => {
    const start = Date.now();

    logger.info(`⚡ [${name}] >>> ${req.method} ${req.url}`, {
      function: name,
      method: req.method,
      url: req.url,
      query: req.query,
      body: req.body,
    });

    // response.json() / response.send() の呼び出しを検知するため
    // finish イベントでログを出力する
    res.on("finish", () => {
      const elapsed = Date.now() - start;
      const level = res.statusCode >= 400 ? "error" : "info";

      const icon = res.statusCode >= 400 ? "❌" : "✅";
      const msg =
        `${icon} [${name}] <<< ${res.statusCode} (${elapsed}ms)`;
      logger[level](msg, {
        function: name,
        statusCode: res.statusCode,
        elapsedMs: elapsed,
      });
    });

    await handler(req, res);
  };
}
