import { XMLParser } from "fast-xml-parser";
import { unzipSync } from "fflate";
import type { NumericParameter, ParsePmdaResult, PkCandidate } from "./types";

type XmlNode = string | number | boolean | null | XmlObject | XmlNode[];

type XmlObject = {
  [key: string]: XmlNode | undefined;
};

type ExtractedTable = {
  caption: string;
  context: string[];
  rows: string[][];
};

const XML_PARSER = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: true,
  trimValues: true,
});

const PARAMETER_KEYS = {
  dose: ["投与量", "用量"],
  auc: ["auc"],
  cmax: ["cmax", "最高血中濃度", "最高血漿中濃度"],
  tmax: ["tmax", "最高濃度到達時間", "最高血中濃度到達時間", "最高血漿中濃度到達時間"],
  halfLife: ["t1/2", "t½", "半減期", "消失半減期"],
};

export function parsePmdaZip(buffer: ArrayBuffer, sourceUrl: string): ParsePmdaResult {
  const bytes = new Uint8Array(buffer);
  const files = unzipSync(bytes);
  const xmlEntry = Object.entries(files).find(([name]) => name.endsWith(".xml"));

  if (!xmlEntry) {
    throw new Error("XMLファイルがZIP内に見つかりませんでした。");
  }

  const xmlText = new TextDecoder("utf-8")
    .decode(xmlEntry[1])
    .replace(/^\uFEFF/, "")
    .replace(/<\?enter\?>/g, "\n");

  return parsePmdaXml(xmlText, sourceUrl);
}

export function parsePmdaXml(xmlText: string, sourceUrl: string): ParsePmdaResult {
  const parsed = XML_PARSER.parse(xmlText) as { PackIns?: XmlObject };
  const root = parsed.PackIns;
  if (!root) {
    throw new Error("PMDA電子添文XMLとして解釈できませんでした。");
  }

  const pharmacokinetics = asObject(root.Pharmacokinetics);
  if (!pharmacokinetics) {
    throw new Error("16.薬物動態セクションが見つかりませんでした。");
  }

  const bloodLevel = asObject(pharmacokinetics.BloodLevel);
  if (!bloodLevel) {
    throw new Error("16.1 血中濃度セクションが見つかりませんでした。");
  }

  const tables = collectTables(bloodLevel, []);
  const tableCandidates = extractCandidates(tables);
  const candidates =
    tableCandidates.length > 0 ? tableCandidates : extractNarrativeCandidates(bloodLevel);

  return {
    sourceUrl,
    packageInsertNo: textOf(root.PackageInsertNo),
    companyIdentifier: textOf(root.CompanyIdentifier),
    revision: extractRevision(root),
    productNames: extractProductNames(root),
    genericName: officialText(root.GenericName),
    therapeuticClassification: officialText(root.TherapeuticClassification),
    indicationsText: officialText(root.IndicationsOrEfficacy),
    mechanismText: officialText(asObject(root.EfficacyPharmacology)?.MechanismOfAction),
    dosageText: extractDosageText(root),
    candidates,
    notes: extractNotes(pharmacokinetics),
  };
}

function collectTables(node: XmlNode, context: string[]): ExtractedTable[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectTables(child, context));
  }

  const object = asObject(node);
  if (!object) {
    return [];
  }

  const nextContext = [...context];
  const headerText = textOf(object.Header);
  if (headerText) {
    nextContext.push(headerText);
  }

  const ownTables = asArray(object.TblBlock).map((block) => ({
    caption: textOf(asObject(block)?.TblCaption),
    context: nextContext,
    rows: tableRows(block),
  }));

  const childTables = Object.entries(object)
    .filter(([key]) => !key.startsWith("@_") && key !== "Header" && key !== "TblBlock")
    .flatMap(([, value]) => (value === undefined ? [] : collectTables(value, nextContext)));

  return [...ownTables, ...childTables];
}

function tableRows(block: XmlNode): string[][] {
  const table = asObject(asObject(block)?.SimpleTable);
  const rows = asArray(table?.SimpTblRow);
  const spans = new Map<number, { text: string; remaining: number }>();

  return rows.map((row) => {
    const cells = asArray(asObject(row)?.SimpTblCell);
    const values: string[] = [];
    let column = 0;

    const fillSpans = () => {
      while (spans.has(column)) {
        const span = spans.get(column);
        if (!span) {
          break;
        }
        values[column] = span.text;
        span.remaining -= 1;
        if (span.remaining <= 0) {
          spans.delete(column);
        }
        column += 1;
      }
    };

    for (const cell of cells) {
      fillSpans();
      const object = asObject(cell);
      const text = normalizeText(textOf(object));
      const colspan = numberAttribute(object, "@_cspan") ?? 1;
      const rowspan = numberAttribute(object, "@_rspan") ?? 1;

      for (let index = 0; index < colspan; index += 1) {
        values[column + index] = text;
        if (rowspan > 1) {
          spans.set(column + index, { text, remaining: rowspan - 1 });
        }
      }
      column += colspan;
    }

    fillSpans();
    return values;
  });
}

function extractCandidates(tables: ExtractedTable[]): PkCandidate[] {
  const candidates: PkCandidate[] = [];

  tables.forEach((table, tableIndex) => {
    if (table.rows.length < 2) {
      return;
    }

    const headerShape = findParameterHeader(table.rows);
    if (!headerShape) {
      return;
    }

    const { headerRowIndex, headers, indexes } = headerShape;
    const doseIndex = indexes.dose >= 0 ? indexes.dose : guessDoseIndex(indexes);

    table.rows.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
      const rowRecord = Object.fromEntries(
        headers.map((header, index) => [header || `列${index + 1}`, row[index] ?? ""]),
      );
      const dose = doseIndex >= 0 ? row[doseIndex] ?? "" : "";
      const cmax = parameterFrom(row[indexes.cmax], headers[indexes.cmax]);
      const tmax = parameterFrom(row[indexes.tmax], headers[indexes.tmax]);
      const halfLife = parameterFrom(row[indexes.halfLife], headers[indexes.halfLife]);

      if (!cmax?.mean || !tmax?.mean || !halfLife?.mean) {
        return;
      }

      candidates.push({
        id: `table-${tableIndex + 1}-row-${rowIndex + 1}`,
        label: buildCandidateLabel(table.context, dose, rowIndex),
        tableCaption: table.caption,
        context: table.context,
        row: rowRecord,
        dose,
        cmax,
        tmax,
        halfLife,
        auc: indexes.auc >= 0 ? parameterFrom(row[indexes.auc], headers[indexes.auc]) : null,
      });
    });
  });

  return candidates;
}

function extractNarrativeCandidates(bloodLevel: XmlObject): PkCandidate[] {
  const text = normalizeText(plainTextOf(bloodLevel));
  const sentences = text.match(/[^。]+。?/g) ?? [text];

  return sentences.flatMap((sentence, sentenceIndex) =>
    extractNarrativeSentenceCandidates(sentence, sentenceIndex),
  );
}

function extractNarrativeSentenceCandidates(sentence: string, sentenceIndex: number): PkCandidate[] {
  if (!/それぞれ/.test(sentence) || !/最高血(?:中|漿中)濃度/.test(sentence) || !/半減期/.test(sentence)) {
    return [];
  }

  const cmaxClause = clauseAfter(
    sentence,
    /最高血(?:中|漿中)濃度(?:[（(][^）)]*[）)])?は、?それぞれ/,
    [/最高血(?:中|漿中)濃度到達時間/, /血(?:中|漿中)濃度[-‐‑‒–—―－ー]?時間曲線下面積/, /消失半減期/],
  );
  const tmaxClause = clauseAfter(
    sentence,
    /最高血(?:中|漿中)濃度到達時間(?:[（(][^）)]*[）)])?は、?それぞれ/,
    [/血(?:中|漿中)濃度[-‐‑‒–—―－ー]?時間曲線下面積/, /消失半減期/],
  );
  const aucClause = clauseAfter(
    sentence,
    /血(?:中|漿中)濃度[-‐‑‒–—―－ー]?時間曲線下面積(?:[（(][^）)]*[）)])?は、?それぞれ/,
    [/消失半減期/],
  );
  const halfLifeClause = clauseAfter(
    sentence,
    /消失半減期(?:[（(][^）)]*[）)])?は、?それぞれ/,
    [/であった/, /である/, /。/],
  );

  if (!cmaxClause || !tmaxClause || !halfLifeClause) {
    return [];
  }

  const leadText = sentence.slice(0, sentence.search(/最高血(?:中|漿中)濃度/));
  const doses = extractDoseLabels(leadText);
  const cmaxValues = extractNumericValues(cmaxClause);
  const tmaxValues = extractNumericValues(tmaxClause);
  const aucValues = aucClause ? extractNumericValues(aucClause) : [];
  const halfLifeValues = extractNumericValues(halfLifeClause);
  const rowCount = Math.min(doses.length, cmaxValues.length, tmaxValues.length, halfLifeValues.length);

  if (rowCount === 0) {
    return [];
  }

  const cmaxHeader = `Cmax（${extractClauseUnit(cmaxClause, "ng/mL")}）`;
  const tmaxHeader = `tmax（${extractClauseUnit(tmaxClause, "時間")}）`;
  const aucHeader = `AUC（${extractClauseUnit(aucClause ?? "", "ng・h/mL")}）`;
  const halfLifeHeader = `t1/2（${extractClauseUnit(halfLifeClause, "時間")}）`;

  return Array.from({ length: rowCount }, (_, index) => {
    const dose = doses[index];
    const aucValue = aucValues[index] ?? "";

    return {
      id: `narrative-${sentenceIndex + 1}-dose-${index + 1}`,
      label: buildCandidateLabel(["16.1 血中濃度", "単回投与の本文"], dose, index),
      tableCaption: "本文から抽出",
      context: ["16.1 血中濃度", "単回投与の本文"],
      row: {
        投与量: dose,
        [cmaxHeader]: cmaxValues[index],
        [tmaxHeader]: tmaxValues[index],
        [aucHeader]: aucValue,
        [halfLifeHeader]: halfLifeValues[index],
      },
      dose,
      cmax: parameterFrom(cmaxValues[index], cmaxHeader),
      tmax: parameterFrom(tmaxValues[index], tmaxHeader),
      halfLife: parameterFrom(halfLifeValues[index], halfLifeHeader),
      auc: aucValue ? parameterFrom(aucValue, aucHeader) : null,
    };
  });
}

function clauseAfter(text: string, start: RegExp, endPatterns: RegExp[]): string | null {
  const match = start.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }

  const startIndex = match.index + match[0].length;
  const rest = text.slice(startIndex);
  const endIndex = endPatterns.reduce<number | null>((nearest, pattern) => {
    const endMatch = pattern.exec(rest);
    if (!endMatch || endMatch.index === undefined) {
      return nearest;
    }
    return nearest === null ? endMatch.index : Math.min(nearest, endMatch.index);
  }, null);

  return normalizeText(rest.slice(0, endIndex ?? undefined));
}

function extractDoseLabels(text: string): string[] {
  return Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*mg(?:\s*注[）)])?/g)).map((match) => {
    const suffix = /注[）)]/.test(match[0]) ? " 注）" : "";
    return `${match[1]}mg${suffix}`;
  });
}

function extractNumericValues(text: string): string[] {
  return Array.from(text.matchAll(/-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)).map(
    (match) => match[0],
  );
}

function extractClauseUnit(text: string, fallback: string): string {
  const compact = text.replace(/\s+/g, "");
  const match = compact.match(
    /(ng・h\/mL|ng\/mL|μg・h\/mL|μg\/mL|pg・h\/mL|pg\/mL|mg・h\/L|mg\/L|時間|hr|h)/i,
  );
  return match?.[1] ?? fallback;
}

function findParameterHeader(
  rows: string[][],
): { headerRowIndex: number; headers: string[]; indexes: Record<keyof typeof PARAMETER_KEYS, number> } | null {
  const lastPossibleHeader = Math.min(rows.length - 2, 3);

  for (let headerRowIndex = 0; headerRowIndex <= lastPossibleHeader; headerRowIndex += 1) {
    const headers = rows[headerRowIndex].map((header, columnIndex) =>
      normalizeHeader(header || rows[headerRowIndex - 1]?.[columnIndex] || ""),
    );
    const indexes = {
      dose: findHeaderIndex(headers, PARAMETER_KEYS.dose),
      auc: findHeaderIndex(headers, PARAMETER_KEYS.auc),
      cmax: findHeaderIndex(headers, PARAMETER_KEYS.cmax),
      tmax: findHeaderIndex(headers, PARAMETER_KEYS.tmax),
      halfLife: findHeaderIndex(headers, PARAMETER_KEYS.halfLife),
    };

    if (indexes.cmax >= 0 && indexes.tmax >= 0 && indexes.halfLife >= 0) {
      return { headerRowIndex, headers, indexes };
    }
  }

  return null;
}

function guessDoseIndex(indexes: Record<keyof typeof PARAMETER_KEYS, number>): number {
  return indexes.cmax > 0 ? 0 : -1;
}

function parameterFrom(value: string | undefined, header: string): NumericParameter | null {
  const raw = normalizeText(value ?? "");
  const mean = parseMean(raw);
  if (mean === null) {
    return null;
  }

  return {
    raw,
    mean,
    unit: extractUnit(header),
  };
}

function parseMean(raw: string): number | null {
  const normalized = raw.replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractUnit(header: string): string {
  const match = header.match(/[（(]([^）)]+)[）)]/);
  return match ? match[1].trim() : "";
}

function findHeaderIndex(headers: string[], needles: string[]): number {
  return headers.findIndex((header) => {
    const compact = compactText(header).toLowerCase();
    return needles.some((needle) => compact.includes(compactText(needle).toLowerCase()));
  });
}

function normalizeHeader(value: string): string {
  return normalizeText(value)
    .replace(/\s+/g, "")
    .replace(/^0-∞AUC/i, "AUC0-∞")
    .replace(/^maxC/i, "Cmax")
    .replace(/^maxt/i, "tmax")
    .replace(/^1\/2t/i, "t1/2");
}

function normalizeText(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}

function officialText(node: XmlNode | undefined): string {
  return cleanOfficialText(plainTextOf(node));
}

function cleanOfficialText(value: string): string {
  return normalizeText(value)
    .replace(/in vitro\s*in vivo/gi, "in vitro / in vivo")
    .replace(/([A-Za-z])([一-龥ぁ-んァ-ヶ])/g, "$1 $2")
    .replace(/(?:\s*,\s*){2,}/g, " ")
    .replace(/\s+([、。，．])/g, "$1")
    .replace(/([。．])\s+/g, "$1")
    .trim();
}

function compactText(value: string): string {
  return value.replace(/[\s＿_・／/]/g, "");
}

function buildCandidateLabel(context: string[], dose: string, rowIndex: number): string {
  const prefix = cleanLabelText(context.join(" / ")) || `表${rowIndex + 1}`;
  const suffix = cleanLabelText(dose);
  return suffix ? `${prefix} ${suffix}` : prefix;
}

function cleanLabelText(value: string): string {
  return normalizeText(value)
    .replace(/〈〉/g, "")
    .replace(/\s*\/\s*$/g, "")
    .replace(/\s*\/\s*\//g, " / ");
}

function extractRevision(root: XmlObject): string {
  const revisions = asArray(asObject(root.DateOfPreparationOrRevision)?.PreparationOrRevision);
  const current =
    revisions.find((revision) => asObject(revision)?.["@_id"] === "今回") ??
    revisions[revisions.length - 1];
  const object = asObject(current);
  const yearMonth = textOf(object?.YearMonth);
  const version = textOf(object?.Version);
  return [yearMonth, version].filter(Boolean).join(" ");
}

function extractProductNames(root: XmlObject): string[] {
  const brands = asArray(asObject(root.ApprovalEtc)?.DetailBrandName);
  return brands
    .map((brand) => textOf(asObject(brand)?.ApprovalBrandName))
    .filter(Boolean);
}

function extractDosageText(root: XmlObject): string {
  return normalizeText(
    plainTextOf(root.InfoDoseAdmin) ||
      plainTextOf(root.DosageAndAdministration) ||
      plainTextOf(root.DoseAdmin),
  );
}

function extractNotes(pharmacokinetics: XmlObject): { title: string; text: string }[] {
  const sections = [
    ["吸収", pharmacokinetics.Absorption],
    ["特定の背景を有する患者", pharmacokinetics.SpecificPopulation],
    ["薬物相互作用", pharmacokinetics.DrugAndDrugInteractions],
  ] as const;

  return sections
    .map(([title, node]) => ({
      title,
      text: normalizeText(plainTextOf(node)).slice(0, 360),
    }))
    .filter((note) => note.text.length > 0);
}

function textOf(node: XmlNode | undefined): string {
  if (node === null || node === undefined) {
    return "";
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join("");
  }

  return Object.entries(node)
    .filter(([key]) => !key.startsWith("@_") && key !== "CommentRef" && key !== "ReferenceBookRef")
    .map(([, value]) => textOf(value))
    .join("");
}

function plainTextOf(node: XmlNode | undefined): string {
  if (node === null || node === undefined) {
    return "";
  }
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(plainTextOf).join("");
  }

  return Object.entries(node)
    .filter(
      ([key]) =>
        !key.startsWith("@_") &&
        key !== "Sub" &&
        key !== "Sup" &&
        key !== "CommentRef" &&
        key !== "ReferenceBookRef",
    )
    .map(([, value]) => plainTextOf(value))
    .join("");
}

function asObject(node: XmlNode | undefined): XmlObject | null {
  return node && typeof node === "object" && !Array.isArray(node) ? node : null;
}

function asArray(node: XmlNode | undefined): XmlNode[] {
  if (node === undefined || node === null) {
    return [];
  }
  return Array.isArray(node) ? node : [node];
}

function numberAttribute(object: XmlObject | null, key: string): number | null {
  if (!object) {
    return null;
  }
  const value = object[key];
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
