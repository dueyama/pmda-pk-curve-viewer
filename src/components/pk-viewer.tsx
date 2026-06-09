"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { simulateCandidate } from "@/lib/pk-model";
import type { ModelPoint, ParsePmdaResult, PkCandidate, SimulationResult } from "@/lib/types";

const SAMPLE_URL =
  "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/780069_4490023F1024_1_25";

const MAX_DISPLAY_DAYS = 60;
const MIN_PROGRESS_MS = 650;

const EXAMPLE_DRUGS = [
  {
    group: "short",
    category: "痛み止め",
    name: "ロキソニン",
    description: "短めの半減期で、時刻を変えた場合の山谷を見やすい例。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/430574_1149019C1149_1_13",
  },
  {
    group: "short",
    category: "解熱鎮痛薬",
    name: "カロナール",
    description: "アセトアミノフェン製剤の例。血中濃度表は2段ヘッダーから読み取ります。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/172190_1141007F1063_5_06",
  },
  {
    group: "short",
    category: "片頭痛薬",
    name: "レルパックス",
    description: "トリプタン系片頭痛薬の例。本文に並ぶ単回投与データから山谷を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/671450_2160005F1021_4_04",
  },
  {
    group: "short",
    category: "片頭痛薬",
    name: "マクサルト",
    description: "片頭痛発作時に使われるトリプタン系の例。短時間の推移を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/181615_2160006F1026_4_01",
  },
  {
    group: "short",
    category: "片頭痛薬",
    name: "ゾーミッグ",
    description: "同じ片頭痛薬でも、成分ごとのtmaxや半減期の違いを眺める例です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/300119_2160004F2023_2_04",
  },
  {
    group: "short",
    category: "片頭痛薬",
    name: "スマトリプタン",
    description: "イミグラン系成分の例。短時間型の片頭痛薬として比較しやすい例です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/400186_2160003F1111_1_08",
  },
  {
    group: "short",
    category: "筋緊張改善薬",
    name: "チザニジン",
    description: "半減期が短い内服薬の例。相互作用欄も大事な薬として見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/530169_1249010F1263_1_05",
  },
  {
    group: "short",
    category: "筋弛緩薬",
    name: "バクロフェン",
    description: "痙性麻痺などで使われる例。複数回投与の山谷を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480866_1249006F1054_3_07",
  },
  {
    group: "steady",
    category: "抗炎症鎮痛薬",
    name: "セレコキシブ",
    description: "ロキソニンより長めに残るNSAIDs例。半減期の違いを見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/430773_1149037F1038_1_07",
  },
  {
    group: "steady",
    category: "抗炎症鎮痛薬",
    name: "メロキシカム",
    description: "半減期が長めのNSAIDs例。1日1回型の残り方を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/530169_1149035F1195_1_11",
  },
  {
    group: "steady",
    category: "抗菌薬",
    name: "レボフロキサシン",
    description: "ニューキノロン系抗菌薬の例。短期間の定時投与で山谷を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480235_6241013F2250_1_11",
  },
  {
    group: "steady",
    category: "降圧薬",
    name: "アムロジピン",
    description: "Ca拮抗薬の例。半減期が長く、1日1回型で残り方を見やすい薬です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/530113_2171022F3080_2_18",
  },
  {
    group: "steady",
    category: "降圧薬",
    name: "ロサルタン",
    description: "ARB系降圧薬の例。活性代謝物があり、濃度と作用のずれも意識する例です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480235_2149039F1104_1_18",
  },
  {
    group: "steady",
    category: "アレルギー薬",
    name: "アレグラ",
    description: "1日2回の標準用法があり、反復服用時の蓄積を見やすい例。",
    url: SAMPLE_URL,
  },
  {
    group: "steady",
    category: "アレルギー薬",
    name: "アレロック",
    description: "抗アレルギー薬の例。眠気注意の文脈も添文から確認します。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/230124_4490025F3026_1_09",
  },
  {
    group: "steady",
    category: "アレルギー薬",
    name: "ロラタジン",
    description: "クラリチン系の例。1日1回型の抗アレルギー薬です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/400278_4490027F1090_1_08",
  },
  {
    group: "steady",
    category: "アレルギー薬",
    name: "タリオン",
    description: "別系統の抗アレルギー薬例。腎機能欄の差も見られます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/400315_4490022F1038_1_15",
  },
  {
    group: "steady",
    category: "胃薬",
    name: "レバミピド",
    description: "日常的に処方される胃薬の例。1日3回入力の挙動を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/430773_2329021F1323_1_03",
  },
  {
    group: "steady",
    category: "糖尿病薬",
    name: "メトグルコ",
    description: "継続服用される慢性疾患薬の例。添文上の注意文も重要。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/400093_3962002F2027_1_22",
  },
  {
    group: "steady",
    category: "糖尿病薬",
    name: "ジャヌビア",
    description: "DPP-4阻害薬の例。1日1回型の血中濃度推移を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/170050_3969010F1034_2_36",
  },
  {
    group: "steady",
    category: "抗血小板薬",
    name: "バイアスピリン",
    description: "低用量アスピリン製剤の例。抗凝固薬とは別の抗血小板薬で、1日1回用法の推移を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/630004_3399007H1021_1_21",
  },
  {
    group: "steady",
    category: "認知症薬",
    name: "アリセプト",
    description: "ドネペジル塩酸塩製剤の例。認知症症状の進行抑制と、その限界の注意も添文で見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/170033_1190012C1020_1_32",
  },
  {
    group: "steady",
    category: "抗精神病薬",
    name: "リスペリドン",
    description: "統合失調症などで使われる例。1日2回型の標準用法と山谷を見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480235_1179038C1116_1_28",
  },
  {
    group: "steady",
    category: "抗精神病薬",
    name: "オランザピン",
    description: "半減期が長めの例。1日1回型で体内に残る感じを見やすい薬です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480235_1179044F4109_1_12",
  },
  {
    group: "steady",
    category: "抗精神病薬",
    name: "アリピプラゾール",
    description: "かなり長めに残る例。定常状態へ近づくまでの遅さを見やすい薬です。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/530100_1179045B1072_1_15",
  },
  {
    group: "steady",
    category: "抗精神病薬",
    name: "レキサルティ",
    description: "ブレクスピプラゾール製剤の例。1日1回型で、半減期が長めの残り方を眺めます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/180078_1179058F3023_1_05",
  },
  {
    group: "monitoring",
    category: "抗凝固薬",
    name: "エリキュース",
    description: "アピキサバン製剤の例。80歳以上などの減量条件や出血リスクの注意も添文で見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/670605_3339004F1029_1_22",
  },
  {
    group: "monitoring",
    category: "抗凝固薬",
    name: "ワーファリン",
    description: "従来から使われるワルファリン製剤の例。INRなどの検査管理が前提の薬として見ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/300119_3332001D1023_2_01",
  },
  {
    group: "monitoring",
    category: "免疫抑制薬",
    name: "タクロリムス",
    description: "免疫の働きを抑える薬。移植後や自己免疫疾患で使われます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/650037_3999014M1057_2_14",
  },
  {
    group: "short",
    category: "睡眠薬",
    name: "ラメルテオン",
    description: "睡眠薬系の例。未変化体と代謝物の候補が出ます。",
    url: "https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/480235_1190016F1075_1_03",
  },
] as const;

const EXAMPLE_GROUPS = [
  {
    id: "short",
    title: "短時間・山谷型",
    description: "頓服や就寝前など、1回ごとのピークと減り方を読む例。",
  },
  {
    id: "steady",
    title: "定時・収束型",
    description: "標準的な定時投与で、平均的には定常状態へ近づく例。",
  },
  {
    id: "monitoring",
    title: "観察・調整型",
    description: "濃度や検査値を見ながら管理される薬。概算グラフだけで判断しない例。",
  },
] as const;

const GLOSSARY_TERMS = [
  {
    term: "PK / 薬物動態",
    description:
      "Pharmacokineticsの略です。薬が体に入る、広がる、代謝される、排泄される流れを、時間と濃度で見る考え方です。",
  },
  {
    term: "血中濃度",
    description:
      "血液中にどれくらい薬があるかを表す量です。このアプリでは添文の単位をそのまま使って、相対的な山谷を見ます。",
  },
  {
    term: "Cmax",
    description:
      "単回投与後などに観察される最高濃度です。値が高いほど、曲線の山が高いという読み方になります。",
  },
  {
    term: "tmax",
    description:
      "Cmaxに到達するまでの時間です。吸収が速い薬ほど短くなりやすく、食事などでずれることもあります。",
  },
  {
    term: "t1/2 / 半減期",
    description:
      "濃度が半分になるまでのおおよその時間です。長いほど体内に残る感じが長くなり、定常状態へ近づくのも遅くなります。",
  },
  {
    term: "AUC",
    description:
      "濃度-時間曲線下面積です。時間全体で体がどれくらい薬にさらされたかを見る代表値です。",
  },
  {
    term: "Cmin",
    description:
      "反復投与中の谷の濃度です。次に飲む直前など、一番低くなるところを見る時に使われます。",
  },
  {
    term: "定常状態",
    description:
      "同じ間隔で服用した時に、入る量と減る量が平均的につり合い、山谷の形がほぼ繰り返しになる状態です。",
  },
  {
    term: "反復投与",
    description:
      "同じ薬を何度も投与することです。このアプリでは単回投与の曲線を、服用時刻ごとに足し合わせて近似します。",
  },
  {
    term: "1コンパートメントモデル",
    description:
      "体内を1つの箱のようにみなし、吸収と消失の速度で濃度変化を近似する単純なモデルです。",
  },
] as const;

const SYMBOL_TERMS = [
  {
    term: "ka",
    description: "吸収速度定数です。薬が体内へ入ってくる速さを表します。",
  },
  {
    term: "ke",
    description: "消失速度定数です。半減期から ke = ln(2) / t1/2 として求めます。",
  },
  {
    term: "C_single(t)",
    description: "1回だけ投与した時、投与後t時間での概算濃度です。",
  },
  {
    term: "C_total(t)",
    description: "複数回投与の濃度です。各投与時刻からのC_singleを足し合わせます。",
  },
  {
    term: "d_i",
    description: "i回目の服用時刻です。時刻ゆらぎを入れた時は、この値が日ごとに少し変わります。",
  },
  {
    term: "S / scale",
    description: "単回投与のピークが添文のCmaxに合うようにする補正係数です。",
  },
  {
    term: "F",
    description: "このアプリでは1回量倍率として扱っています。1回量を2倍にした時はF=2という簡略仮定です。",
  },
  {
    term: "ln(2)",
    description: "自然対数の2です。半減期から指数関数的な減り方を計算する時に出てきます。",
  },
] as const;

const SERIES_COLORS = {
  standard: "#256f67",
  compare: "#b7834a",
};

const JITTER_PRESETS = [
  { label: "なし", hours: 0 },
  { label: "±1h", hours: 1 },
  { label: "±3h", hours: 3 },
  { label: "±6h", hours: 6 },
] as const;

type LoadState =
  | { status: "idle" }
  | { status: "loading"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; data: ParsePmdaResult };

type Regimen = {
  id: "standard" | "compare";
  name: string;
  times: string;
  doseMultiplier: number;
  timingJitterHours: number;
  color: string;
};

type ChartSeries = {
  id: string;
  name: string;
  color: string;
  result: SimulationResult;
};

export function PkViewer() {
  const [url, setUrl] = useState(SAMPLE_URL);
  const [activeExampleUrl, setActiveExampleUrl] = useState(SAMPLE_URL);
  const [days, setDays] = useState(5);
  const [selectedId, setSelectedId] = useState("");
  const [regimens, setRegimens] = useState<Regimen[]>(() => buildRegimens(""));
  const [showComparison, setShowComparison] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });

  const candidates = loadState.status === "ready" ? loadState.data.candidates : [];
  const selectedCandidate =
    candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null;
  const visibleRegimens = useMemo(
    () => (showComparison ? regimens : regimens.filter((regimen) => regimen.id === "standard")),
    [regimens, showComparison],
  );

  const series = useMemo<ChartSeries[]>(() => {
    if (!selectedCandidate) {
      return [];
    }

    return visibleRegimens.flatMap((regimen) => {
      const result = simulateCandidate(
        selectedCandidate,
        regimen.times,
        days,
        regimen.doseMultiplier,
        regimen.timingJitterHours,
      );
      return result
        ? [
            {
              id: regimen.id,
              name: regimen.name,
              color: regimen.color,
              result,
            },
          ]
        : [];
    });
  }, [days, selectedCandidate, visibleRegimens]);

  const loadPmda = useCallback(async (nextUrl: string) => {
    const startedAt = Date.now();
    setUrl(nextUrl);
    setActiveExampleUrl(exampleUrlOrEmpty(nextUrl));
    setLoadState({
      status: "loading",
      message: "PMDAへ接続しています。XMLデータセットを取得・解析しています。",
    });

    try {
      const response = await fetch("/api/parse-pmda", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: nextUrl }),
      });
      const payload = (await response.json()) as ParsePmdaResult | { error?: string };

      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "解析できませんでした。");
      }

      setLoadState({
        status: "loading",
        message: "解析結果を受信しました。グラフと抽出値を準備しています。",
      });

      const data = payload as ParsePmdaResult;
      await waitForMinimumProgress(startedAt);
      setLoadState({ status: "ready", data });
      setSelectedId(data.candidates[0]?.id ?? "");
      setRegimens(buildRegimens(data.dosageText));
      setShowComparison(false);
    } catch (error) {
      await waitForMinimumProgress(startedAt);
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : "解析中にエラーが発生しました。",
      });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPmda(SAMPLE_URL);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPmda]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadPmda(url);
  }

  function handleExampleSelect(nextUrl: string) {
    setUrl(nextUrl);
    setActiveExampleUrl(nextUrl);
  }

  function updateRegimen(id: Regimen["id"], patch: Partial<Regimen>) {
    setRegimens((current) =>
      current.map((regimen) => (regimen.id === id ? { ...regimen, ...patch } : regimen)),
    );
  }

  function resetToStandard() {
    const dosageText = loadState.status === "ready" ? loadState.data.dosageText : "";
    const [standardRegimen] = buildRegimens(dosageText);
    setRegimens((current) =>
      current.map((regimen) => (regimen.id === "standard" ? standardRegimen : regimen)),
    );
  }

  function applyComparisonPreset() {
    const dosageText = loadState.status === "ready" ? loadState.data.dosageText : "";
    setRegimens(buildRegimens(dosageText));
    setShowComparison(true);
  }

  return (
    <main className="app-shell">
      <section className="hero-panel" aria-labelledby="app-title">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <span />
          </div>
          <div>
            <p className="brand-name">薬物動態カーブビューア</p>
            <p className="brand-subtitle">PMDA電子添文から血中濃度の時間推移を描く</p>
          </div>
        </div>

        <div className="hero-grid">
          <div>
            <h1 id="app-title">薬の血中濃度が、時間とともにどう変わるか。</h1>
            <p className="lead">
              PMDA電子添文の薬物動態表と用法及び用量を読み取り、Cmax、tmax、t1/2から数日間の概算血中濃度を描きます。入力条件を変えた比較は補助的な観察機能です。
            </p>
          </div>
          <div className="safety-banner">
            <strong>医療判断には使えません</strong>
            <span>
              この可視化は経口薬と、Cmax・tmax・t1/2が表で取れる注射薬を想定しています。貼付剤などの持続入力型は別モデルです。添文上の集団平均値に基づく概算で、服薬方法の提案ではありません。表示日数は最大{MAX_DISPLAY_DAYS}日です。
            </span>
          </div>
        </div>
      </section>

      <form className="url-bar" onSubmit={handleSubmit}>
        <label htmlFor="pmda-url">PMDA XML URL</label>
        <input
          id="pmda-url"
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setActiveExampleUrl(exampleUrlOrEmpty(event.target.value));
          }}
          placeholder="https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetXML/..."
        />
        <button type="submit" disabled={loadState.status === "loading"}>
          <SearchIcon />
          {loadState.status === "loading" ? "解析中" : "解析する"}
        </button>
      </form>

      <PmdaUrlGuide />
      <ReuseNotice />

      <ExampleDrugStrip
        activeUrl={activeExampleUrl}
        parsedUrl={loadState.status === "ready" ? loadState.data.sourceUrl : ""}
        disabled={loadState.status === "loading"}
        parseStatus={
          loadState.status === "loading" || loadState.status === "error"
            ? { status: loadState.status, message: loadState.message }
            : { status: loadState.status }
        }
        onAnalyze={loadPmda}
        onSelect={handleExampleSelect}
      />

      {loadState.status === "error" ? (
        <div className="alert-panel" role="alert">
          {loadState.message}
        </div>
      ) : null}

      <section className="workspace-grid">
        <aside className="control-panel" aria-label="服用条件">
          <div className="section-heading">
            <span>Input</span>
            <h2>服用条件</h2>
          </div>

          <DosageBox data={loadState.status === "ready" ? loadState.data : null} />
          <ComparisonGuide />

          <label className="field">
            <span>表示日数</span>
            <input
              type="number"
              min="1"
              max={MAX_DISPLAY_DAYS}
              value={days}
              onChange={(event) => setDays(clampDays(event.target.value))}
            />
          </label>

          <label className="field">
            <span>投与条件</span>
            <select
              value={selectedCandidate?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={candidates.length === 0}
            >
              {candidates.length === 0 ? (
                <option>PMDA XMLを解析してください</option>
              ) : (
                candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="compare-toggle">
            <input
              checked={showComparison}
              onChange={(event) => setShowComparison(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>観察条件を重ねる</strong>
              <small>標準用法だけを基本表示にし、必要な時だけ比較線を追加します。</small>
            </span>
          </label>

          <div className="regimen-list">
            {visibleRegimens.map((regimen) => (
              <div className="regimen-card" key={regimen.id}>
                <div className="regimen-header">
                  <span style={{ background: regimen.color }} />
                  <input
                    aria-label={`${regimen.name}の名前`}
                    value={regimen.name}
                    onChange={(event) => updateRegimen(regimen.id, { name: event.target.value })}
                  />
                </div>

                <label className="field compact-field">
                  <span>服用時刻</span>
                  <input
                    value={regimen.times}
                    onChange={(event) => updateRegimen(regimen.id, { times: event.target.value })}
                    placeholder="08:00, 13:00, 19:00"
                  />
                </label>

                <label className="field compact-field">
                  <span>1回量倍率</span>
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={regimen.doseMultiplier}
                    onChange={(event) =>
                      updateRegimen(regimen.id, { doseMultiplier: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="field compact-field">
                  <span>時刻ゆらぎ ±時間</span>
                  <input
                    type="number"
                    min="0"
                    max="12"
                    step="0.5"
                    value={regimen.timingJitterHours}
                    onChange={(event) =>
                      updateRegimen(regimen.id, { timingJitterHours: Number(event.target.value) })
                    }
                  />
                </label>
                <div className="jitter-presets" aria-label={`${regimen.name}の時刻ゆらぎプリセット`}>
                  {JITTER_PRESETS.map((preset) => (
                    <button
                      className={
                        regimen.timingJitterHours === preset.hours
                          ? "jitter-preset active"
                          : "jitter-preset"
                      }
                      key={preset.hours}
                      onClick={() =>
                        updateRegimen(regimen.id, { timingJitterHours: preset.hours })
                      }
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <RegimenSummary regimen={regimen} />
              </div>
            ))}
          </div>

          <div className="quick-actions">
            <button type="button" onClick={resetToStandard}>
              標準用法に戻す
            </button>
            <button type="button" onClick={applyComparisonPreset}>
              観察条件を初期化
            </button>
          </div>
        </aside>

        <section className="chart-panel" id="simulation-panel" aria-label="血中濃度グラフ">
          <div className="chart-header">
            <div>
              <span>Simulation</span>
              <h2>血中濃度の時間推移</h2>
            </div>
            <MetricStrip candidate={selectedCandidate} series={series} />
          </div>

          {series.length > 0 ? (
            <ConcentrationChart
              cmax={selectedCandidate?.cmax?.mean ?? null}
              cmaxUnit={selectedCandidate?.cmax?.unit ?? ""}
              series={series}
              days={days}
            />
          ) : (
            <div className="empty-chart">
              <GraphIcon />
              <p>PMDA XMLを解析し、Cmax・tmax・t1/2を含む行を選ぶと濃度推移グラフが表示されます。</p>
            </div>
          )}
        </section>

        <aside className="detail-panel" aria-label="解析結果と数式">
          <div className="section-heading">
            <span>Parameters</span>
            <h2>抽出値</h2>
          </div>

          {loadState.status === "ready" ? (
            <>
              <SourceSummary data={loadState.data} />
              <OfficialSummary data={loadState.data} />
              <ParameterTable candidate={selectedCandidate} />
              <FormulaBlock candidate={selectedCandidate} series={series} />
              <NotesList notes={loadState.data.notes} />
            </>
          ) : (
            <p className="muted-copy">
              解析後に標準用法、製品名、改訂年月、薬物動態パラメータ、注意文の抜粋がここに表示されます。
            </p>
          )}
        </aside>
      </section>

      <GlossarySection />
      <AppFooter />
    </main>
  );
}

function AppFooter() {
  return (
    <footer className="app-footer">
      <small>Copyright (c) 2026 dueyama. アプリケーションコード: MIT License.</small>
    </footer>
  );
}

function PmdaUrlGuide() {
  return (
    <section className="pmda-url-guide" aria-label="PMDA XML URLの探し方">
      <strong>PMDAからXML URLを使う</strong>
      <p>
        PMDAの添付文書検索で薬を開き、添文ページにあるXMLデータのリンク、または
        <code>ResultDataSetXML</code> を含むURLをこの入力欄に入れます。XMLでも添文ごとに表・本文・単位の形が違うため、すべてを自動抽出できるとは限りません。
      </p>
      <div>
        <a href="https://www.pmda.go.jp/" target="_blank" rel="noreferrer">
          PMDAホーム
        </a>
        <a href="https://www.pmda.go.jp/PmdaSearch/iyakuSearch/" target="_blank" rel="noreferrer">
          添付文書検索
        </a>
      </div>
    </section>
  );
}

function ReuseNotice() {
  return (
    <section className="reuse-notice" aria-label="出典と二次利用">
      <strong>出典と加工表示</strong>
      <p>
        出典: 独立行政法人医薬品医療機器総合機構（PMDA）ウェブサイト。本アプリはPMDA公開情報をもとに薬物動態パラメータを抽出・加工して概算可視化したもので、PMDAまたは製造販売業者による公式な計算結果ではありません。PDF/XML本体は保存・同梱せず、入力されたURLを必要時に取得します。
      </p>
      <div>
        <a href="https://www.pmda.go.jp/0048.html" target="_blank" rel="noreferrer">
          PMDAサイトポリシー
        </a>
        <a
          href="https://www.digital.go.jp/resources/open_data/public_data_license_v1.0"
          target="_blank"
          rel="noreferrer"
        >
          公共データ利用規約
        </a>
      </div>
    </section>
  );
}

function ExampleDrugStrip({
  activeUrl,
  parsedUrl,
  disabled,
  parseStatus,
  onAnalyze,
  onSelect,
}: {
  activeUrl: string;
  parsedUrl: string;
  disabled: boolean;
  parseStatus: { status: LoadState["status"]; message?: string };
  onAnalyze: (url: string) => Promise<void>;
  onSelect: (url: string) => void;
}) {
  const activeDrug = EXAMPLE_DRUGS.find((drug) => drug.url === activeUrl);
  const isParsed =
    activeDrug !== undefined &&
    normalizePmdaExampleUrl(activeDrug.url) === normalizePmdaExampleUrl(parsedUrl);
  const statusMessage =
    parseStatus.status === "loading"
      ? parseStatus.message
      : parseStatus.status === "error"
        ? `解析できませんでした。${parseStatus.message}`
        : isParsed
          ? "解析済みです。下のグラフで標準用法の血中濃度推移を確認できます。"
          : "URLを入力欄にセットしました。解析するとPMDA XMLを取得します。";

  return (
    <section className="example-strip" aria-label="代表的な薬">
      <div className="example-strip-header">
        <span>Examples</span>
        <p>
          代表例は経口薬中心です。薬を選ぶとURL入力欄にXML URLをセットします。解析するとPMDA XMLを取得し、下の「血中濃度の時間推移」に曲線を表示します。
        </p>
      </div>
      <div className="example-groups">
        {EXAMPLE_GROUPS.map((group) => {
          const drugs = EXAMPLE_DRUGS.filter((drug) => drug.group === group.id);

          return (
            <div className={`example-group ${group.id}`} key={group.id}>
              <div className="example-group-header">
                <strong>{group.title}</strong>
                <p>{group.description}</p>
              </div>
              <div className="example-cards">
                {drugs.map((drug) => {
                  const isActive = drug.url === activeUrl;

                  return (
                    <button
                      aria-pressed={isActive}
                      className={isActive ? "example-card active" : "example-card"}
                      disabled={disabled}
                      key={drug.url}
                      onClick={() => {
                        onSelect(drug.url);
                      }}
                      type="button"
                    >
                      <div className="example-card-top">
                        <span className="example-card-category">{drug.category}</span>
                        {isActive ? <span className="selected-chip">選択中</span> : null}
                      </div>
                      <strong>{drug.name}</strong>
                      <p>{drug.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {activeDrug ? (
        <div
          className={
            parseStatus.status === "loading"
              ? "example-selection-status loading"
              : parseStatus.status === "error"
                ? "example-selection-status error"
                : "example-selection-status"
          }
          aria-live="polite"
        >
          <strong>{activeDrug.name}を選択中</strong>
          <span>{isParsed ? "解析済みの曲線を表示できます。" : "カード選択だけでは取得しません。"}</span>
          <button
            disabled={disabled}
            onClick={() => {
              if (isParsed) {
                scrollToSimulationPanel();
                return;
              }
              void onAnalyze(activeDrug.url).then(scrollToSimulationOnMobile);
            }}
            type="button"
          >
            {disabled ? "解析中" : isParsed ? "グラフへ移動" : "この薬を解析"}
          </button>
          <small className="example-action-progress" role="status">
            {parseStatus.status === "loading" ? "進行中: " : ""}
            {statusMessage}
          </small>
        </div>
      ) : null}
    </section>
  );
}

function scrollToSimulationOnMobile() {
  if (window.matchMedia("(max-width: 840px)").matches) {
    scrollToSimulationPanel();
  }
}

function scrollToSimulationPanel() {
  const panel = document.getElementById("simulation-panel");
  panel?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}

function exampleUrlOrEmpty(value: string): string {
  const normalized = normalizePmdaExampleUrl(value);
  return EXAMPLE_DRUGS.find((drug) => normalizePmdaExampleUrl(drug.url) === normalized)?.url ?? "";
}

function normalizePmdaExampleUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function DosageBox({ data }: { data: ParsePmdaResult | null }) {
  return (
    <div className="dosage-box">
      <span>標準用法</span>
      <p>{data?.dosageText || "PMDA XMLを解析すると、6.用法及び用量の本文がここに表示されます。"}</p>
    </div>
  );
}

function ComparisonGuide() {
  return (
    <div className="comparison-guide">
      <span>比較で見る問い</span>
      <p>
        1日量が同じでも、回数を減らして1回量を増やすと、このモデルではピーク濃度が高くなり、谷も深くなることがあります。同じ量なら同じ曲線になる、とは限りません。
      </p>
      <p>
        飲む時刻が毎日少しゆらいでも曲線は大きく変わらないのか。時刻ゆらぎは、その影響を眺めるための観察条件です。
      </p>
      <small>比較線は服用方法の提案ではありません。飲み方を変えてよいか、安全かどうかは、このグラフだけでは判断できません。</small>
    </div>
  );
}

function RegimenSummary({ regimen }: { regimen: Regimen }) {
  const timesCount = countDosingTimes(regimen.times);
  const dailyMultiplier = timesCount * regimen.doseMultiplier;
  const jitterText =
    regimen.timingJitterHours > 0
      ? ` ・ 時刻ゆらぎ±${formatMultiplier(regimen.timingJitterHours)}時間`
      : " ・ 規則的";

  return (
    <p className="regimen-summary">
      1日{timesCount}回 × 1回量{formatMultiplier(regimen.doseMultiplier)} = 1日量
      {formatMultiplier(dailyMultiplier)}
      {jitterText}
    </p>
  );
}

function MetricStrip({
  candidate,
  series,
}: {
  candidate: PkCandidate | null;
  series: ChartSeries[];
}) {
  const metrics = [
    ["Cmax", candidate?.cmax ? `${candidate.cmax.mean} ${candidate.cmax.unit}` : "-"],
    ["tmax", candidate?.tmax ? `${candidate.tmax.mean} ${candidate.tmax.unit}` : "-"],
    ...series.map((item) => [item.name, item.result.peak.toFixed(1)]),
  ].slice(0, 4);

  return (
    <div className="metric-strip">
      {metrics.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ConcentrationChart({
  cmax,
  cmaxUnit,
  series,
  days,
}: {
  cmax: number | null;
  cmaxUnit: string;
  series: ChartSeries[];
  days: number;
}) {
  const width = 920;
  const height = 390;
  const padding = { top: 52, right: 28, bottom: 48, left: 62 };
  const maxHour = Math.max(days * 24, 24);
  const maxConcentration =
    Math.max(...series.flatMap((item) => item.result.points.map((point) => point.concentration)), 1) *
    1.14;
  const x = (hour: number) =>
    padding.left + (hour / maxHour) * (width - padding.left - padding.right);
  const y = (value: number) =>
    padding.top +
    (1 - value / maxConcentration) * (height - padding.top - padding.bottom);

  const yTicks = Array.from({ length: 5 }, (_, index) => (maxConcentration / 4) * index);
  const dayTickStep = days <= 14 ? 1 : days <= 30 ? 2 : 5;
  const dayTickCount = Math.floor(days / dayTickStep) + 1;
  const dayTicks = Array.from({ length: dayTickCount }, (_, index) => index * dayTickStep * 24);
  if (dayTicks[dayTicks.length - 1] !== days * 24) {
    dayTicks.push(days * 24);
  }
  const primarySeries = series[0];

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="数日間の概算血中濃度比較曲線">
        <defs>
          <linearGradient id="curveFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2e7d73" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#2e7d73" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={width} height={height} rx="18" fill="#fbfcfb" />

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#dfe7e3"
            />
            <text x={padding.left - 12} y={y(tick) + 4} textAnchor="end" className="chart-tick">
              {tick.toFixed(0)}
            </text>
          </g>
        ))}

        {dayTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={x(tick)}
              x2={x(tick)}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke={tick === 0 ? "#b8c8c1" : "#edf2ef"}
            />
            <text x={x(tick)} y={height - 18} textAnchor="middle" className="chart-tick">
              {tick === 0 ? "開始" : `${tick / 24}日`}
            </text>
          </g>
        ))}

        {series.flatMap((item) =>
          item.result.doses.slice(0, 10).map((dose, index) => (
            <g key={`${item.id}-${dose.hour}-${index}`}>
              <line
                x1={x(dose.hour)}
                x2={x(dose.hour)}
                y1={padding.top}
                y2={height - padding.bottom}
                stroke={item.color}
                strokeDasharray="4 8"
                opacity="0.22"
              />
              {dose.hour < 24 ? (
                <text
                  x={x(dose.hour)}
                  y={item.id === "compare" ? 16 : 32}
                  textAnchor="middle"
                  className="dose-label"
                  style={{ fill: item.color }}
                >
                  {item.id === "standard" ? "標" : "比"} {dose.label}
                </text>
              ) : null}
            </g>
          )),
        )}

        {primarySeries ? <path d={areaPath(primarySeries.result.points, x, y, maxHour)} fill="url(#curveFill)" /> : null}
        {series.map((item) => (
          <path
            d={linePath(item.result.points, x, y)}
            fill="none"
            key={item.id}
            stroke={item.color}
            strokeLinecap="round"
            strokeWidth={item.id === "standard" ? 4 : 3.5}
          />
        ))}
        {cmax !== null && cmax > 0 ? (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(cmax)}
              y2={y(cmax)}
              stroke="#9a3412"
              strokeDasharray="8 7"
              strokeWidth="2"
              opacity="0.78"
            />
            <rect
              x={width - padding.right - 128}
              y={y(cmax) - 19}
              width="128"
              height="24"
              rx="6"
              fill="#fff8ef"
              stroke="#efd7b7"
            />
            <text
              x={width - padding.right - 64}
              y={y(cmax) - 3}
              textAnchor="middle"
              className="cmax-label"
            >
              Cmax {cmax} {cmaxUnit}
            </text>
          </g>
        ) : null}
      </svg>

      <div className="chart-legend">
        {series.map((item) => (
          <span key={item.id}>
            <i style={{ background: item.color }} />
            {item.name} peak {item.result.peak.toFixed(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceSummary({ data }: { data: ParsePmdaResult }) {
  const pmdaDetailUrl = data.sourceUrl.replace(
    "/PmdaSearch/iyakuDetail/ResultDataSetXML/",
    "/PmdaSearch/iyakuDetail/",
  );

  return (
    <div className="source-summary">
      <span>Source</span>
      <strong>{data.productNames.join(" / ") || "製品名未取得"}</strong>
      <p>
        {data.packageInsertNo} {data.revision}
      </p>
      <div className="source-links">
        <a href={pmdaDetailUrl} target="_blank" rel="noreferrer">
          PMDA添文ページ
        </a>
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">
          XMLデータ
        </a>
      </div>
    </div>
  );
}

function OfficialSummary({ data }: { data: ParsePmdaResult }) {
  const rows = [
    ["一般名", data.genericName],
    ["薬効分類", data.therapeuticClassification],
    ["効能・効果", data.indicationsText],
    ["作用機序", data.mechanismText],
  ].filter(([, value]) => value);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="official-summary">
      {rows.map(([label, value]) => (
        <div className="official-row" key={label}>
          <span>{label}</span>
          <p>{clipText(value, 180)}</p>
        </div>
      ))}
    </div>
  );
}

function ParameterTable({ candidate }: { candidate: PkCandidate | null }) {
  if (!candidate) {
    return <p className="muted-copy">利用できる候補行がありません。</p>;
  }

  const rows = [
    ["投与量", candidate.dose || "-"],
    ["AUC", formatParameter(candidate.auc)],
    ["tmax", formatParameter(candidate.tmax)],
    ["Cmax", formatParameter(candidate.cmax)],
    ["t1/2", formatParameter(candidate.halfLife)],
  ];

  return (
    <table className="parameter-table">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FormulaBlock({
  candidate,
  series,
}: {
  candidate: PkCandidate | null;
  series: ChartSeries[];
}) {
  const firstResult = series[0]?.result ?? null;
  const warnings = Array.from(new Set(series.flatMap((item) => item.result.warnings)));

  return (
    <div className="formula-block">
      <div className="section-heading compact">
        <span>Formula</span>
        <h2>使った近似式</h2>
      </div>
      <div className="model-explain">
        <strong>一般的な吸収・消失モデルで再現</strong>
        <p>
          経口投与後、薬が体内へ入る速さを一次吸収 k<sub>a</sub>、体内から減る速さを一次消失 k<sub>e</sub>
          とみなす、1コンパートメントモデルの形です。単回投与の曲線は Bateman 関数として知られる
          「立ち上がってから指数関数的に下がる」近似になります。
        </p>
        <p>
          ここでの消失は、分解・代謝・排泄などをまとめた見かけの減り方です。個人差、活性代謝物、非線形性、徐放剤、貼付剤などは、この可視化では単純化しています。
        </p>
      </div>
      <div className="math-stack" aria-label="使用した薬物動態近似式">
        <div className="equation">
          <span>
            k<sub>e</sub>
          </span>
          <span>=</span>
          <span className="frac">
            <span>ln(2)</span>
            <span>
              t<sub>1/2</sub>
            </span>
          </span>
        </div>
        <div className="equation">
          <span>
            C<sub>single</sub>(t)
          </span>
          <span>=</span>
          <span>
            F · S · (e<sup>-k<sub>e</sub>t</sup> - e<sup>-k<sub>a</sub>t</sup>)
          </span>
        </div>
        <div className="equation">
          <span>
            C<sub>total</sub>(t)
          </span>
          <span>=</span>
          <span className="sum">
            <span>n</span>
            <strong>Σ</strong>
            <span>i=1</span>
          </span>
          <span>
            C<sub>single</sub>(t - d<sub>i</sub>)
          </span>
        </div>
        <p className="math-note">
          Fは1回量倍率、SはCmaxに合わせる補正係数、d_iは各服用時刻です。時刻ゆらぎがある場合、d_iは日ごとに固定乱数で少し変わります。
        </p>
      </div>
      {candidate && firstResult ? (
        <p>
          ke={firstResult.ke.toFixed(4)}、ka={firstResult.ka.toFixed(4)}、scale=
          {firstResult.scale.toFixed(2)}。dose_factor=1の単回ピークが添文のCmaxに合うよう補正しています。
        </p>
      ) : (
        <p>候補行を選ぶと、推定したke、ka、scaleが表示されます。</p>
      )}
      {warnings.map((warning) => (
        <p className="warning-copy" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  );
}

function NotesList({ notes }: { notes: ParsePmdaResult["notes"] }) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="notes-list">
      {notes.slice(0, 3).map((note) => (
        <details key={note.title}>
          <summary>{note.title}</summary>
          <p>{note.text}</p>
        </details>
      ))}
    </div>
  );
}

function GlossarySection() {
  return (
    <section className="glossary-section" aria-labelledby="glossary-title">
      <div className="glossary-head">
        <div className="section-heading">
          <span>Glossary</span>
          <h2 id="glossary-title">語録辞典</h2>
        </div>
        <p>
          グラフや数式に出てくる略語と記号の早見表です。ここでは薬物動態を眺めるための最小限の意味に絞っています。
        </p>
      </div>

      <div className="glossary-columns">
        <GlossaryList title="よく出る語" items={GLOSSARY_TERMS} />
        <GlossaryList title="数式の記号" items={SYMBOL_TERMS} />
      </div>
    </section>
  );
}

function GlossaryList({
  title,
  items,
}: {
  title: string;
  items: readonly { term: string; description: string }[];
}) {
  return (
    <div className="glossary-list">
      <h3>{title}</h3>
      <dl>
        {items.map((item) => (
          <div key={item.term}>
            <dt>{item.term}</dt>
            <dd>{item.description}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function buildRegimens(dosageText: string): Regimen[] {
  const frequency = getRegimenFrequency(dosageText);
  const standardTimes = inferStandardTimes(dosageText, frequency);
  const compareRegimen =
    frequency > 1
      ? {
          id: "compare" as const,
          name: "観察用: 1日量を朝1回にまとめる",
          times: "08:00",
          doseMultiplier: frequency,
          timingJitterHours: 0,
          color: SERIES_COLORS.compare,
        }
      : {
          id: "compare" as const,
          name: "観察用: 時刻ゆらぎ±3時間",
          times: standardTimes,
          doseMultiplier: 1,
          timingJitterHours: 3,
          color: SERIES_COLORS.compare,
        };

  return [
    {
      id: "standard",
      name: frequency > 1 ? `標準用法（1日${frequency}回）` : "標準用法（1日1回）",
      times: standardTimes,
      doseMultiplier: 1,
      timingJitterHours: 0,
      color: SERIES_COLORS.standard,
    },
    compareRegimen,
  ];
}

function getRegimenFrequency(dosageText: string): number {
  return inferFrequency(dosageText) ?? 2;
}

function inferFrequency(text: string): number | null {
  const normalized = text.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
  const match = normalized.match(/1日\s*([0-9]+)\s*回/);
  if (!match) {
    return null;
  }

  const frequency = Number(match[1]);
  return Number.isFinite(frequency) && frequency > 0 ? Math.min(frequency, 6) : null;
}

function timesForFrequency(frequency: number): string {
  const presets: Record<number, string> = {
    1: "08:00",
    2: "08:00, 20:00",
    3: "08:00, 13:00, 19:00",
    4: "08:00, 12:00, 18:00, 22:00",
  };

  if (presets[frequency]) {
    return presets[frequency];
  }

  const interval = 24 / frequency;
  return Array.from({ length: frequency }, (_, index) => {
    const hour = Math.round(index * interval) % 24;
    return `${String(hour).padStart(2, "0")}:00`;
  }).join(", ");
}

function inferStandardTimes(dosageText: string, frequency: number): string {
  if (frequency === 1 && /就寝前|寝る前/.test(dosageText)) {
    return "22:00";
  }

  return timesForFrequency(frequency);
}

function countDosingTimes(times: string): number {
  const count = times
    .split(",")
    .map((time) => time.trim())
    .filter(Boolean).length;

  return Math.max(1, count);
}

function formatMultiplier(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function waitForMinimumProgress(startedAt: number): Promise<void> {
  const remaining = MIN_PROGRESS_MS - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => window.setTimeout(resolve, remaining)) : Promise.resolve();
}

function linePath(
  points: ModelPoint[],
  x: (hour: number) => number,
  y: (value: number) => number,
): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(point.hour).toFixed(2)} ${y(point.concentration).toFixed(2)}`,
    )
    .join(" ");
}

function areaPath(
  points: ModelPoint[],
  x: (hour: number) => number,
  y: (value: number) => number,
  maxHour: number,
): string {
  return `${linePath(points, x, y)} L ${x(maxHour).toFixed(2)} ${y(0).toFixed(2)} L ${x(0).toFixed(2)} ${y(0).toFixed(2)} Z`;
}

function formatParameter(parameter: PkCandidate["cmax"]): string {
  if (!parameter) {
    return "-";
  }
  return `${parameter.raw}${parameter.unit ? ` ${parameter.unit}` : ""}`;
}

function clipText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function clampDays(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(MAX_DISPLAY_DAYS, Math.max(1, Math.round(parsed)));
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M7 35h34" />
      <path d="M10 31c5-12 9-12 14-4s9 5 14-12" />
      <path d="M10 13v22" />
    </svg>
  );
}
