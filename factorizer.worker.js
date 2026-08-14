'use strict';

// ---- BigInt ユーティリティ -------------------------------------------------

/** 整数平方根（ニュートン法） */
function isqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

function powMod(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % mod;
    base = base * base % mod;
    exp >>= 1n;
  }
  return result;
}

function gcd(a, b) {
  while (b) { const t = a % b; a = b; b = t; }
  return a < 0n ? -a : a;
}

/** Miller-Rabin 素数判定。2^64 未満は下記の底で決定的、それ以上は確率的（誤判定率は無視できる水準） */
function isPrime(n) {
  if (n < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n, r = 0n;
  while ((d & 1n) === 0n) { d >>= 1n; r++; }
  const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const a of bases) {
    let x = powMod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1n; i < r; i++) {
      x = x * x % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

// ---- 進捗レポート ----------------------------------------------------------

const REPORT_INTERVAL = 100;  // ms
const REPORT_DELAY = 250;     // これより短時間で終わるときは途中経過を出さない

let startTime = 0;
let lastReport = 0;
const found = [];        // 発見済みの素因数（BigInt）
let progressShown = false;

function report(phase, detail, percent) {
  const now = performance.now();
  if (now - startTime < REPORT_DELAY) return;
  if (now - lastReport < REPORT_INTERVAL) return;
  lastReport = now;
  progressShown = true;
  self.postMessage({
    type: 'progress',
    phase, detail, percent,
    elapsed: now - startTime,
    found: found.map(String),
  });
}

// ---- 分解本体 --------------------------------------------------------------

const TRIAL_LIMIT = 10000000n;  // 試し割りの打ち切り（これ以降は Pollard's rho に任せる）
const WHEEL = [4n, 2n, 4n, 2n, 4n, 6n, 2n, 6n];  // 30 を法とした 7 からの増分

/** 小さい素数での試し割り。分解しきれなかった残りを返す */
function trialDivision(n) {
  for (const p of [2n, 3n, 5n]) {
    while (n % p === 0n) { found.push(p); n /= p; }
  }
  let limit = isqrt(n);
  if (limit > TRIAL_LIMIT) limit = TRIAL_LIMIT;

  let d = 7n, wi = 0, steps = 0;
  const limitNum = Number(limit);
  while (d <= limit) {
    if (n % d === 0n) {
      while (n % d === 0n) { found.push(d); n /= d; }
      // n が小さくなったので上限を引き直す
      limit = isqrt(n);
      if (limit > TRIAL_LIMIT) limit = TRIAL_LIMIT;
      report('trial', { divisor: d.toString(), remaining: n.toString() }, null);
      if (n === 1n) return n;
    }
    d += WHEEL[wi];
    wi = (wi + 1) & 7;
    if ((++steps & 0x3fff) === 0) {
      const pct = limitNum > 0 ? Math.min(99.9, Number(d) / limitNum * 100) : 100;
      report('trial', { divisor: d.toString(), remaining: n.toString() }, pct);
    }
  }
  return n;
}

/** Pollard's rho (Brent 版)。n の自明でない約数を 1 つ返す */
function pollardRho(n, round) {
  if ((n & 1n) === 0n) return 2n;
  let c = BigInt(round) + 1n;
  while (true) {
    let x = 2n, y = 2n, d = 1n, q = 1n;
    let r = 1n, m = 128n, iter = 0;
    y = c;
    let ys = y, g = 1n;
    do {
      x = y;
      for (let i = 0n; i < r; i++) y = (y * y + c) % n;
      let k = 0n;
      while (k < r && g === 1n) {
        ys = y;
        const lim = (m < r - k) ? m : r - k;
        for (let i = 0n; i < lim; i++) {
          y = (y * y + c) % n;
          const diff = x > y ? x - y : y - x;
          q = q * diff % n;
        }
        g = gcd(q, n);
        k += lim;
        iter++;
        report('rho', { digits: n.toString().length, iter, remaining: n.toString() }, null);
      }
      r <<= 1n;
    } while (g === 1n);

    if (g === n) {
      // 巻き戻して 1 ステップずつ再試行
      g = 1n;
      do {
        ys = (ys * ys + c) % n;
        const diff = x > ys ? x - ys : ys - x;
        g = gcd(diff, n);
      } while (g === 1n);
    }
    if (g !== n) return g;
    c += 1n;  // 失敗したので多項式を変えてやり直し
  }
}

/** n（1 より大）を再帰的に分解して found に積む */
function factorRest(n, round) {
  if (n === 1n) return;
  if (isPrime(n)) { found.push(n); return; }
  const d = pollardRho(n, round);
  factorRest(d, round + 1);
  factorRest(n / d, round + 1);
}

self.onmessage = (e) => {
  let n;
  try {
    n = BigInt(e.data.value);
  } catch (_) {
    self.postMessage({ type: 'error', message: '整数として解釈できません。' });
    return;
  }
  if (n < 2n) {
    self.postMessage({ type: 'error', message: '2 以上の整数を入力してください。' });
    return;
  }

  found.length = 0;
  startTime = performance.now();
  lastReport = 0;
  progressShown = false;

  try {
    const rest = trialDivision(n);
    factorRest(rest, 0);
  } catch (err) {
    self.postMessage({ type: 'error', message: '計算中にエラーが発生しました: ' + err.message });
    return;
  }

  const elapsed = performance.now() - startTime;
  found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  self.postMessage({
    type: 'done',
    factors: found.map(String),
    elapsed,
    progressShown,
  });
};
