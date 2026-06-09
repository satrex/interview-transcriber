import "server-only";

import OpenAI from "openai";

const MAX_CONCURRENT_REQUESTS = 5;

const PUNCTUATION_INSTRUCTIONS = `あなたは日本語インタビュー文字起こしの校正補助です。
以下の発話テキストに、読みやすく自然な範囲で句読点「、」「。」を追加してください。

厳守:
- 発言内容を変えない
- 言い換えない
- 要約しない
- 語尾を変えない
- 不自然な補足をしない
- 誤字と思われる箇所も勝手に直しすぎない
- 追加してよいのは句読点「、」「。」を中心とする
- 返答は補正後テキストのみ`;

export type PunctuationInput = {
  segmentId: string;
  text: string;
};

export type PunctuationResult = {
  editedText: string;
  segmentId: string;
};

export async function punctuateJapaneseSegments(
  segments: PunctuationInput[],
): Promise<PunctuationResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_PUNCTUATION_MODEL;

  if (!apiKey || !model) {
    throw new Error(
      "OPENAI_API_KEY と OPENAI_PUNCTUATION_MODEL を設定してください。",
    );
  }

  const openai = new OpenAI({ apiKey });
  const results: PunctuationResult[] = [];

  for (let offset = 0; offset < segments.length; offset += MAX_CONCURRENT_REQUESTS) {
    const group = segments.slice(offset, offset + MAX_CONCURRENT_REQUESTS);
    const groupResults = await Promise.all(
      group.map(async (segment) => {
        const response = await openai.responses.create({
          input: `${PUNCTUATION_INSTRUCTIONS}\n\n入力:\n${segment.text}`,
          max_output_tokens: Math.min(
            4096,
            Math.max(256, Math.ceil(segment.text.length * 2)),
          ),
          model,
          store: false,
        });
        const editedText = response.output_text.trim();

        assertOnlyPunctuationChanged(segment.text, editedText);

        return {
          editedText,
          segmentId: segment.segmentId,
        };
      }),
    );

    results.push(...groupResults);
  }

  return results;
}

function assertOnlyPunctuationChanged(original: string, edited: string) {
  if (!edited) {
    throw new Error("句読点補正結果が空でした。");
  }

  if (stripAllowedAdditions(original) !== stripAllowedAdditions(edited)) {
    throw new Error(
      "AIの補正結果に句読点・改行以外の変更が含まれたため、このバッチは保存しませんでした。",
    );
  }
}

function stripAllowedAdditions(value: string) {
  return value.replace(/[、。\r\n]/g, "");
}
