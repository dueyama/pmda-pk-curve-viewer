import type { ParsePmdaResult } from "./types";

export const MEIACT_XML_URL =
  "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/780009_6132015F1037_1_11";

// 数値は電子添文XMLの表から取得する。ここでは一次資料で確認した条件だけを補足する。
export function addSampleReference(data: ParsePmdaResult): ParsePmdaResult {
  if (
    data.companyIdentifier !== "780009" ||
    data.packageInsertNo !== "6132015F1037_1_11" ||
    !data.productNames.includes("メイアクトMS錠100mg")
  ) {
    return data;
  }

  return {
    ...data,
    candidates: data.candidates.map((candidate) => {
      if (
        candidate.tableCaption !== "表1　健康成人の薬物動態パラメータ" ||
        !candidate.context.includes("単回投与（旧錠剤）") ||
        !/^(100|200)$/.test(candidate.dose.trim())
      ) {
        return candidate;
      }
      const dose = `${candidate.dose.trim()}mg（力価）`;
      return {
        ...candidate,
        allowSlowAbsorption: true,
        dose,
        label: `健康成人・旧錠剤・食後単回 ${dose}`,
      };
    }),
    modelReference: {
      title: "成人錠剤・食後の参考モデル（ピーク形状の近似）",
      concentrationLabel: "セフジトレンの血清中総濃度（μg/mL）",
      studyCondition: "健康成人、旧錠剤の食後単回経口投与、n=5、平均値。選択した投与量の表の値を使います。",
      formulationNote: "製剤成分はセフジトレン ピボキシル、血中測定活性体はセフジトレンです。添文16.1の注に、現MS錠と旧錠剤の生物学的同等性が確認されている旨の記載があります。",
      doseNote: "mg（力価）はセフジトレンとしての量です。分子量換算や蛋白結合率による遊離濃度への換算は行いません。",
      limitations: "小児用細粒、空腹時、腎機能障害の曲線には流用できません。食事・臓器機能・相互作用・個人差は反映しません。用量比例と反復投与の加算は概算仮定です。この曲線は実測の半減期・AUCを同時には再現しません。実測の反復曲線の再現も保証しません。医療判断には使えません。",
      sourceUrl: "https://www.info.pmda.go.jp/go/interview/1/780009_6132015F1037_1_01A_1F.pdf",
      sourceLabel: "PMDAインタビューフォーム（冊子9・39・41–42頁）",
    },
  };
}
