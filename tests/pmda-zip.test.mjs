import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { readPmdaXml, assertXmlLimits } from "../src/lib/pmda-zip.ts";
import { parsePmdaXml } from "../src/lib/pmda-parser.ts";
import { PMDA_LIMITS } from "../src/lib/pmda-limits.ts";

const xml="<PackIns><GenericName>検証用</GenericName></PackIns>";
const encode=s=>new TextEncoder().encode(s);
const archive=(entries={"a.xml":encode(xml)})=>zipSync(entries);
const asBuffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const limits=values=>({...PMDA_LIMITS,...values});

test("正常なstored/deflated XMLだけを読み、未使用画像は展開しない",()=>{
  for(const level of [0,6]){
    const zip=zipSync({"a.xml":encode(xml),"figure.gif":encode("not an image decoder input")},{level});
    assert.equal(readPmdaXml(asBuffer(zip)),xml);
  }
});

test("ZIP件数・総容量・XML容量を展開前のmetadataで制限する",()=>{
  const zip=archive({"a.xml":encode(xml),"b.gif":encode("12345678")});
  for(const override of [{zipEntries:1},{zipBytes:8},{xmlBytes:8},{declaredExpandedBytes:8}]){
    assert.throws(()=>readPmdaXml(asBuffer(zip),limits(override)),e=>e.code==="DATA_TOO_LARGE");
  }
});

test("実際の膨張が宣言を超える小さなZIPを出力上限で拒否する",()=>{
  const zip=Buffer.from(archive({"a.xml":encode("A".repeat(64))}));
  const central=zip.indexOf(Buffer.from([0x50,0x4b,1,2]));
  zip.writeUInt32LE(8,22);
  zip.writeUInt32LE(8,central+24);
  assert.throws(()=>readPmdaXml(asBuffer(zip)),e=>e.code==="INVALID_DATASET");
});

test("曖昧なXML選択・破損CRC・暗号化・不正なパス・ZIP64を拒否する",()=>{
  assert.throws(()=>readPmdaXml(asBuffer(archive({"a.xml":encode(xml),"b.xml":encode(xml)}))));
  assert.throws(()=>readPmdaXml(asBuffer(archive({"../a.xml":encode(xml)}))));
  const original=Buffer.from(archive());
  const central=original.indexOf(Buffer.from([0x50,0x4b,1,2]));
  for(const change of [
    zip=>{zip.writeUInt32LE(0,14);zip.writeUInt32LE(0,central+16);},
    zip=>{zip.writeUInt16LE(1,6);zip.writeUInt16LE(1,central+8);},
    zip=>zip.writeUInt32LE(0xffffffff,central+24),
    zip=>zip.writeUInt32LE(0xffffffff,central+42),
  ]){
    const zip=Buffer.from(original);change(zip);
    assert.throws(()=>readPmdaXml(asBuffer(zip)));
  }
});

test("XMLの容量・深さ・タグ数を制限し、DTDを拒否する",()=>{
  for(const [input,override]of [[xml,{xmlBytes:8}],["<a><b><c/></b></a>",{xmlDepth:1}],["<a><b/><c/></a>",{xmlTags:2}]]){
    assert.throws(()=>assertXmlLimits(input,limits(override)),e=>e.code==="DATA_TOO_LARGE");
  }
  assert.throws(()=>assertXmlLimits('<!DOCTYPE PackIns [<!ENTITY x "x">]><PackIns/>'));
  assert.doesNotThrow(()=>assertXmlLimits('<a attr=">"><!-- <fake> --><![CDATA[<fake>]]><b/></a>'));
});

test("小さなXMLの巨大な表spanを展開前に拒否する",()=>{
  for(const span of ["129","1000000000000","1.5"]){
    const input='<PackIns><Pharmacokinetics><BloodLevel><TblBlock><SimpleTable><SimpTblRow><SimpTblCell cspan="'+span+'">x</SimpTblCell></SimpTblRow></SimpleTable></TblBlock></BloodLevel></Pharmacokinetics></PackIns>';
    assert.throws(()=>parsePmdaXml(input,"https://www.pmda.go.jp/"),e=>e.code==="DATA_TOO_LARGE");
  }
});

test("表結合による文字列の論理的な増幅にも容量上限を適用する",()=>{
  const input='<PackIns><Pharmacokinetics><BloodLevel><TblBlock><SimpleTable><SimpTblRow><SimpTblCell cspan="128">'+"x".repeat(32769)+'</SimpTblCell></SimpTblRow></SimpleTable></TblBlock></BloodLevel></Pharmacokinetics></PackIns>';
  assert.throws(()=>parsePmdaXml(input,"https://www.pmda.go.jp/"),e=>e.code==="DATA_TOO_LARGE");
});
