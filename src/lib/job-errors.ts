export type JobErrorCode =
  | "quota_exceeded"
  | "rate_limited"
  | "openai_error"
  | "unknown"
  | (string & {});

export function getJobErrorDisplayMessage(errorCode: JobErrorCode | null) {
  switch (errorCode) {
    case "quota_exceeded":
      return "現在、文字起こし処理の利用上限に達しています。時間をおいて再実行してください。";
    case "rate_limited":
      return "現在、処理が混み合っています。少し時間をおいて再実行してください。";
    case "openai_error":
      return "文字起こし処理中にエラーが発生しました。";
    case "unknown":
    case null:
    default:
      return "予期しないエラーが発生しました。";
  }
}
