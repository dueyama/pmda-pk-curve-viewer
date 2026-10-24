import { crc32, inflateRawSync } from "node:zlib";
import { PMDA_LIMITS, type PmdaLimits } from "./pmda-limits";
import { PmdaError } from "./pmda-errors";

type Entry = { name: string; start: number; end: number; method: number; size: number; crc: number };

// Central Directoryを先に検査し、必要なXMLだけを出力上限付きで展開する。
// 未使用の画像・他のファイルは展開もディスクへの書出しもしない。
export function readPmdaXml(buffer: ArrayBuffer, limits: PmdaLimits = PMDA_LIMITS): string {
  const zip = Buffer.from(buffer);
  const invalid = () => { throw new PmdaError("INVALID_DATASET"); };
  if (zip.length > limits.zipBytes) throw new PmdaError("DATA_TOO_LARGE");
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) return invalid();
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return invalid();
  const count = zip.readUInt16LE(eocd + 10);
  if (count > limits.zipEntries) throw new PmdaError("DATA_TOO_LARGE");
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralStart = zip.readUInt32LE(eocd + 16);
  // ZIP64/分割アーカイブはこの小さなPMDAデータセットでは扱わない。
  if (!count || count === 0xffff || zip.readUInt16LE(eocd + 4) ||
      zip.readUInt16LE(eocd + 6) || zip.readUInt16LE(eocd + 8) !== count ||
      centralStart + centralSize !== eocd) return invalid();
  const entries: Entry[] = [];
  let cursor = centralStart;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || zip.readUInt32LE(cursor) !== 0x02014b50) return invalid();
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameSize = zip.readUInt16LE(cursor + 28);
    const extraSize = zip.readUInt16LE(cursor + 30);
    const commentSize = zip.readUInt16LE(cursor + 32);
    const offset = zip.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameSize + extraSize + commentSize;
    if (next > eocd || flags & 0x41 || (method !== 0 && method !== 8) ||
        compressedSize === 0xffffffff || size === 0xffffffff ||
        zip.readUInt16LE(cursor + 34) !== 0) return invalid();
    const rawName = zip.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = rawName.toString("utf8");
    if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") ||
        name.split("/").some(part => part === ".." || part === ".")) return invalid();
    if (offset + 30 > centralStart || zip.readUInt32LE(offset) !== 0x04034b50 ||
        zip.readUInt16LE(offset + 6) !== flags || zip.readUInt16LE(offset + 8) !== method) return invalid();
    const localNameSize = zip.readUInt16LE(offset + 26);
    const localExtraSize = zip.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameSize + localExtraSize;
    const end = start + compressedSize;
    if (end > centralStart || localNameSize !== nameSize ||
        !zip.subarray(offset + 30, offset + 30 + localNameSize).equals(rawName)) return invalid();
    if (!(flags & 8) && (zip.readUInt32LE(offset + 14) !== crc ||
        zip.readUInt32LE(offset + 18) !== compressedSize || zip.readUInt32LE(offset + 22) !== size)) return invalid();
    expanded += size;
    if (expanded > limits.declaredExpandedBytes || (name.endsWith(".xml") && size > limits.xmlBytes)) {
      throw new PmdaError("DATA_TOO_LARGE");
    }
    if (method === 0 && size !== compressedSize) return invalid();
    entries.push({ name, start, end, method, size, crc });
    cursor = next;
  }
  if (cursor !== eocd) return invalid();
  const xmlEntries = entries.filter(entry => entry.name.endsWith(".xml"));
  if (xmlEntries.length !== 1 || !xmlEntries[0].size) return invalid();
  const xml = xmlEntries[0];
  let bytes: Buffer;
  try {
    bytes = xml.method === 0 ? zip.subarray(xml.start, xml.end) :
      inflateRawSync(zip.subarray(xml.start, xml.end), { maxOutputLength: Math.min(xml.size, limits.xmlBytes) });
  } catch {
    return invalid();
  }
  if (bytes.length !== xml.size || crc32(bytes) !== xml.crc) return invalid();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "").replace(/<\?enter\?>/g, "\n");
  } catch {
    return invalid();
  }
}

// 引用符・コメント・CDATA中の「<」はタグとして数えない。DTD/独自entityは受け付けない。
export function assertXmlLimits(xml: string, limits: PmdaLimits = PMDA_LIMITS): void {
  if (Buffer.byteLength(xml, "utf8") > limits.xmlBytes) throw new PmdaError("DATA_TOO_LARGE");
  let cursor = 0;
  let depth = 0;
  let tags = 0;
  while ((cursor = xml.indexOf("<", cursor)) >= 0) {
    let terminator = "";
    if (xml.startsWith("<!--", cursor)) terminator = "-->";
    else if (xml.startsWith("<![CDATA[", cursor)) terminator = "]]>";
    else if (xml.startsWith("<?", cursor)) terminator = "?>";
    else if (xml.startsWith("<!", cursor)) throw new PmdaError("INVALID_DATASET");
    if (terminator) {
      const end = xml.indexOf(terminator, cursor + 2);
      if (end < 0) throw new PmdaError("INVALID_DATASET");
      cursor = end + terminator.length;
      continue;
    }
    let quote = "";
    let end = cursor + 1;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = ""; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === xml.length) throw new PmdaError("INVALID_DATASET");
    tags++;
    if (xml[cursor + 1] === "/") depth--;
    else if (xml[end - 1] !== "/") depth++;
    if (depth < 0) throw new PmdaError("INVALID_DATASET");
    if (depth > limits.xmlDepth || tags > limits.xmlTags) throw new PmdaError("DATA_TOO_LARGE");
    cursor = end + 1;
  }
  if (depth !== 0) throw new PmdaError("INVALID_DATASET");
}
