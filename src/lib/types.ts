export type NumericParameter = {
  raw: string;
  mean: number | null;
  unit: string;
  calculationNote?: string;
};

export type PkCandidate = {
  id: string;
  label: string;
  tableCaption: string;
  context: string[];
  row: Record<string, string>;
  dose: string;
  cmax: NumericParameter | null;
  tmax: NumericParameter | null;
  halfLife: NumericParameter | null;
  auc: NumericParameter | null;
  modelExclusionReason?: string;
  // 出典条件を確認した参考モデルでだけ、ka < ke の形状推定を許可する。
  allowSlowAbsorption?: boolean;
};

export type ParsePmdaResult = {
  sourceUrl: string;
  packageInsertNo: string;
  companyIdentifier: string;
  revision: string;
  productNames: string[];
  genericName: string;
  therapeuticClassification: string;
  indicationsText: string;
  mechanismText: string;
  dosageText: string;
  candidates: PkCandidate[];
  curveUnavailableReason?: string;
  modelReference?: {
    title: string;
    concentrationLabel: string;
    studyCondition: string;
    formulationNote: string;
    doseNote: string;
    limitations: string;
    sourceUrl: string;
    sourceLabel: string;
  };
  notes: {
    title: string;
    text: string;
  }[];
};

export type ModelPoint = {
  hour: number;
  day: number;
  concentration: number;
};

export type DoseEvent = {
  hour: number;
  label: string;
  amountMultiplier: number;
};

export type SimulationResult = {
  points: ModelPoint[];
  doses: DoseEvent[];
  ke: number;
  ka: number;
  scale: number;
  doseMultiplier: number;
  peak: number;
  warnings: string[];
};
