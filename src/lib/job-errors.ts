export type JobErrorCode =
  | "quota_exceeded"
  | "rate_limited"
  | "unsupported_prompt_for_diarization"
  | "openai_error"
  | "unknown"
  | (string & {});

export function getJobErrorDisplayMessage(errorCode: JobErrorCode | null) {
  switch (errorCode) {
    case "quota_exceeded":
      return "現在、文字起こし処理の利用上限に達しています。時間をおいて再実行してください。";
    case "rate_limited":
      return "現在、処理が混み合っています。少し時間をおいて再実行してください。";
    case "unsupported_prompt_for_diarization":
      return "現在の話者識別モデルではプロンプト指定が使えないため、文字起こしに失敗しました。設定を見直してください。";
    case "openai_error":
      return "文字起こし処理中にエラーが発生しました。";
    case "unknown":
    case null:
    default:
      return "予期しないエラーが発生しました。";
  }
}
