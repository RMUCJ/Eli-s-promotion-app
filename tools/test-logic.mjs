/* =============================================================================
   test-logic.mjs — behavioural tests for the grader and the SRS engine
   -----------------------------------------------------------------------------
   Run:  node tools/test-logic.mjs

   verify.mjs checks that the question DATA is well-formed and grounded in the
   source guide. This file checks that the CODE does the right thing with it:

     1. every question's own correct answer grades as correct
     2. every accepted alias on a type-the-answer question is accepted
     3. a clearly wrong answer is rejected — no false positives
     4. an incomplete answer never counts as correct
     5. matching questions with duplicate right-hand values grade correctly,
        including when the two identical values are swapped between rows
     6. a wrong answer resets the card to box 0 and makes it due immediately
     7. the session builder puts overdue cards first and never repeats one
     8. mastery reads 0% untouched and 100% fully boxed
   ========================================================================== */

/* Unit-test the grader and SRS engine directly, headlessly. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const R = join(dirname(fileURLToPath(import.meta.url)), '..') + '/';
globalThis.window={};
if (existsSync(R+'data/questions.js')) {
  new Function('window', readFileSync(R+'data/questions.js','utf8'))(globalThis.window);
} else if (process.env.MQI_KEY) {
  const { loadBank } = await import('./seal.mjs');
  globalThis.window.QUESTION_BANK = (await loadBank(process.env.MQI_KEY)).questions;
} else {
  console.log('\n  Content is sealed and no MQI_KEY is set — nothing to test.');
  console.log('  Run "node tools/seal.mjs unseal" locally, or set the MQI_KEY secret in CI.\n');
  process.exit(0);
}
// minimal DOM shim for quiz.js (only check/answerText are exercised)
globalThis.document={createElement:()=>({append(){},addEventListener(){},setAttribute(){},classList:{toggle(){},add(){},remove(){}},style:{}}),createTextNode:()=>({})};
globalThis.Store={markStudiedToday(){}};
// `const X = ...` inside new Function() stays function-scoped, unlike a real
// <script> tag, so export the bindings explicitly.
new Function(readFileSync(R+'js/srs.js','utf8')+';globalThis.SRS=SRS;').call(globalThis);
new Function(readFileSync(R+'js/quiz.js','utf8')+';globalThis.Quiz=Quiz;').call(globalThis);
const {Quiz,SRS}=globalThis;
const B=globalThis.window.QUESTION_BANK;
let fail=0,pass=0;
const t=(n,c,x='')=>{ c?pass++:(fail++,console.log('  ✗ '+n+(x?' :: '+x:''))); };

/* 1. Every question's OWN correct answer must grade as correct. */
for(const q of B){
  let ans;
  switch(q.type){
    case 'mc': case 'tf': ans=q.answer; break;
    case 'multi': ans=q.answer.slice(); break;
    case 'order': ans=q.items.slice(); break;
    case 'match': ans=q.pairs.map(p=>p[1]); break;
    case 'fill': ans=q.answer; break;
    case 'numeric': ans=String(q.answer); break;
  }
  t('self-grades correct: '+q.id, Quiz.check(q,ans)===true);
}

/* 2. Every ACCEPTED alias on a fill question must also grade correct. */
for(const q of B.filter(q=>q.type==='fill'))
  for(const a of q.accept)
    t('accepts alias '+q.id+' "'+a+'"', Quiz.check(q,a)===true);

/* 3. A clearly wrong answer must grade as WRONG (no false positives). */
for(const q of B){
  let bad;
  switch(q.type){
    case 'mc': bad=(q.answer+1)%q.choices.length; break;
    case 'tf': bad=!q.answer; break;
    case 'multi': { const all=q.choices.map((_,i)=>i);
      bad=all.filter(i=>!q.answer.includes(i));
      if(!bad.length) bad=[q.answer[0]]; break; }
    case 'order': bad=[...q.items.slice(1),q.items[0]]; break;
    case 'match': bad=q.pairs.map(p=>p[1]).slice().reverse();
      if(q.pairs.every((p,i)=>bad[i]===p[1])) bad=null; break;
    case 'fill': bad='zzzz not the answer'; break;
    case 'numeric': bad=String(q.answer+1000+(q.tol||0)); break;
  }
  if(bad!==null) t('rejects wrong answer: '+q.id, Quiz.check(q,bad)===false, JSON.stringify(bad).slice(0,60));
}

/* 4. Incomplete answers never count as correct. */
for(const q of B) t('null is wrong: '+q.id, Quiz.check(q,null)===false);

/* 5. Duplicate-value match questions: the DUPLICATED value must be selectable
      for BOTH rows and grade correct (the defect the verifier caught). */
const dupQs=B.filter(q=>q.type==='match' && new Set(q.pairs.map(p=>p[1])).size < q.pairs.length);
t('duplicate-value match questions exist to test', dupQs.length===4, 'found '+dupQs.length);
for(const q of dupQs){
  t('dup-match grades correct '+q.id, Quiz.check(q,q.pairs.map(p=>p[1]))===true);
  const uniq=[...new Set(q.pairs.map(p=>p[1]))];
  t('dup-match option list dedupes '+q.id, uniq.length < q.pairs.length);
  // swapping the two rows that share a value must STILL be correct
  const vals=q.pairs.map(p=>p[1]);
  const dupVal=vals.find((v,i)=>vals.indexOf(v)!==i);
  const idx=vals.map((v,i)=>v===dupVal?i:-1).filter(i=>i>=0);
  const swapped=vals.slice(); [swapped[idx[0]],swapped[idx[1]]]=[swapped[idx[1]],swapped[idx[0]]];
  t('dup-match swap of identical values still correct '+q.id, Quiz.check(q,swapped)===true);
}

/* 6. SRS: wrong answer resets to box 0 and is due immediately. */
{
  const prog={cards:{},answered:0,correct:0,days:[],exams:[],sessions:0};
  const id=B[0].id;
  for(let i=0;i<4;i++) SRS.grade(prog,id,true);
  t('4 correct reaches mastery box', SRS.card(prog,id).box===4 && SRS.isMastered(prog,id),'box='+SRS.card(prog,id).box);
  t('mastered card not due for days', SRS.card(prog,id).due > Date.now()+7*86400000-1000);
  SRS.grade(prog,id,false);
  t('one wrong resets to box 0', SRS.card(prog,id).box===0);
  t('wrong card is due immediately', SRS.card(prog,id).due <= Date.now()+50);
  t('wrong card no longer mastered', !SRS.isMastered(prog,id));
  t('stats tracked', prog.answered===5 && prog.correct===4, JSON.stringify({a:prog.answered,c:prog.correct}));
  t('box caps at MAX_BOX', (()=>{const p2={cards:{},answered:0,correct:0,days:[],exams:[],sessions:0};
    for(let i=0;i<20;i++) SRS.grade(p2,id,true); return SRS.card(p2,id).box===SRS.MAX_BOX;})());
}

/* 7. Session builder surfaces DUE cards before untouched ones. */
{
  const prog={cards:{},answered:0,correct:0,days:[],exams:[],sessions:0};
  const overdue=B.slice(0,5).map(q=>q.id);
  for(const id of overdue){ SRS.grade(prog,id,false); prog.cards[id].due=Date.now()-86400000; }
  const s=SRS.buildSession(prog,{size:10});
  const firstFive=s.slice(0,5).map(q=>q.id);
  t('due cards come first', overdue.every(id=>firstFive.includes(id)), firstFive.join(','));
  t('session respects size', SRS.buildSession(prog,{size:7}).length===7);
  t('topic filter works', SRS.buildSession(prog,{topics:['risk'],size:20}).every(q=>q.topic==='risk'));
  t('exam mode spans all topics',
    new Set(SRS.buildSession(prog,{mode:'exam',size:30}).map(q=>q.topic)).size===6);
  t('no duplicate questions in a session',
    (()=>{const x=SRS.buildSession(prog,{size:40}).map(q=>q.id);return new Set(x).size===x.length;})());
}

/* 8. Mastery maths. */
{
  const prog={cards:{},answered:0,correct:0,days:[],exams:[],sessions:0};
  t('untouched bank is 0% mastery', SRS.overallMastery(prog)===0);
  for(const q of B) for(let i=0;i<SRS.MASTER_BOX;i++) SRS.grade(prog,q.id,true);
  t('fully-boxed bank is 100% mastery', SRS.overallMastery(prog)===100, String(SRS.overallMastery(prog)));
  t('every topic reads 100%', SRS.TOPICS.every(t2=>SRS.topicMastery(prog,t2.key)===100));
}

console.log(`\n  ${pass} assertions passed, ${fail} failed\n`);
process.exit(fail?1:0);
