import assert from 'node:assert/strict';
import test from 'node:test';
import {parsePmdaXml} from '../src/lib/pmda-parser.ts';
import {simulateCandidate} from '../src/lib/pk-model.ts';
const table='<TblBlock><SimpleTable><SimpTblRow><SimpTblCell>Cmax（ng/mL）</SimpTblCell><SimpTblCell>tmax（hr）</SimpTblCell><SimpTblCell>t1/2（hr）</SimpTblCell></SimpTblRow><SimpTblRow><SimpTblCell>44.26</SimpTblCell><SimpTblCell>4.2</SimpTblCell><SimpTblCell>64.59</SimpTblCell></SimpTblRow></SimpleTable></TblBlock>'.replaceAll('<SimpTblCell>','<SimpTblCell><Detail><Lang>').replaceAll('</SimpTblCell>','</Lang></Detail></SimpTblCell>');
test('反復・定常状態の表は抽出値を保全し、単回曲線への適用を拒否する',()=>{
 for(const heading of ['反復投与','連続投与','定常状態','単回投与']){
 const d=parsePmdaXml(`<PackIns><Pharmacokinetics><BloodLevel><Section><Header>${heading}</Header>${table}</Section></BloodLevel></Pharmacokinetics></PackIns>`,'https://www.pmda.go.jp/');
 assert.equal(d.candidates.length,1);const c=d.candidates[0];assert.equal(c.cmax.mean,44.26);
 if(heading==='単回投与'){assert.equal(c.modelExclusionReason,undefined);assert.ok(simulateCandidate(c,'08:00',5));}else{assert.match(c.modelExclusionReason,/単回投与/);assert.equal(simulateCandidate(c,'08:00',5),null);}
 }
});
