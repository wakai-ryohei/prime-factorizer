// factorizer.worker.js の分解ロジックを Node 上で検証する
//   実行: node test.js
'use strict';

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'factorizer.worker.js'), 'utf8');

// Worker のグローバル (self) をスタブして読み込む
const messages = [];
const selfStub = { postMessage: (m) => messages.push(m), onmessage: null };
const load = new Function('self', 'performance',
  src + '\nreturn { onmessage: self.onmessage, isPrime, isqrt };');
const worker = load(selfStub, performance);

function factorize(value) {
  messages.length = 0;
  worker.onmessage({ data: { value } });
  return {
    done: messages.find((m) => m.type === 'done'),
    error: messages.find((m) => m.type === 'error'),
    progress: messages.filter((m) => m.type === 'progress'),
  };
}

let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? 'OK  ' : 'NG  '}${label}`); };

// --- 分解結果 ---------------------------------------------------------------
const cases = [
  ['2', ['2']],
  ['4', ['2', '2']],
  ['12', ['2', '2', '3']],
  ['97', ['97']],
  ['1024', Array(10).fill('2')],
  ['600851475143', ['71', '839', '1471', '6857']],
  ['999999999989', ['999999999989']],                        // 12 桁の素数
  ['18446744073709551617', ['274177', '67280421310721']],    // 2^64 + 1
  ['147573952589676412927', ['193707721', '761838257287']],  // 2^67 - 1
  ['100000000000880000000001887', ['10000000000037', '10000000000051']],  // 27 桁の半素数
  ['123456789012345678901234567890', null],                  // 30 桁（期待値は積と素数性のみ確認）
];

for (const [value, expected] of cases) {
  const r = factorize(value);
  if (r.error) { check(false, `${value} -> エラー: ${r.error.message}`); continue; }
  const got = r.done.factors;
  const product = got.reduce((acc, f) => acc * BigInt(f), 1n);
  const ok = product === BigInt(value)                       // 積が入力値に戻る
    && got.every((f) => worker.isPrime(BigInt(f)))           // 各因数が素数
    && (!expected || JSON.stringify(got) === JSON.stringify(expected));
  check(ok, `${value} = ${got.join(' x ')}  (${r.done.elapsed.toFixed(1)}ms, 進捗 ${r.progress.length} 件)`);
}

// --- 入力エラー -------------------------------------------------------------
for (const bad of ['0', '1', 'abc', '']) {
  const r = factorize(bad);
  check(!!r.error, `異常系 "${bad}" -> ${r.error ? r.error.message : 'エラーにならなかった'}`);
}

// --- 途中経過 ---------------------------------------------------------------
const slow = factorize('100000000000880000000001887');
check(slow.progress.length > 0, `時間のかかる入力で進捗が送られる (${slow.progress.length} 件)`);
check(slow.progress.every((m) => m.elapsed >= 250),
  '進捗は 250ms 経過後にのみ送られる（短時間の入力では表示しない）');
check(factorize('12').progress.length === 0, '一瞬で終わる入力では進捗を送らない');

// --- 補助関数 ---------------------------------------------------------------
check(worker.isqrt(144n) === 12n && worker.isqrt(145n) === 12n && worker.isqrt(0n) === 0n, 'isqrt');
check(worker.isPrime(2n) && worker.isPrime(1000000007n) && !worker.isPrime(1000000009n * 3n), 'isPrime');

console.log(failed === 0 ? '\nすべて成功' : `\n${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
