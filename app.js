'use strict';

const $ = (id) => document.getElementById(id);
const inputEl = $('input');
const runBtn = $('run');
const cancelBtn = $('cancel');
const errorEl = $('error');
const progressCard = $('progress-card');
const resultCard = $('result-card');
const barEl = $('bar');
const barFill = barEl.firstElementChild;

let worker = null;

function fmtDuration(ms) {
  if (ms < 1) return ms.toFixed(3) + ' ミリ秒';
  if (ms < 1000) return ms.toFixed(2) + ' ミリ秒';
  if (ms < 60000) return (ms / 1000).toFixed(3) + ' 秒';
  const m = Math.floor(ms / 60000);
  return m + ' 分 ' + ((ms - m * 60000) / 1000).toFixed(1) + ' 秒';
}

/** 3 桁ごとに区切る（BigInt 文字列用） */
function group(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function setRunning(running) {
  runBtn.disabled = running;
  cancelBtn.classList.toggle('hidden', !running);
  inputEl.disabled = running;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function start() {
  const raw = inputEl.value.trim().replace(/[,\s_]/g, '');
  errorEl.classList.add('hidden');
  resultCard.classList.add('hidden');
  progressCard.classList.add('hidden');

  if (!raw) { showError('数値を入力してください。'); return; }
  if (!/^\d+$/.test(raw)) { showError('半角数字のみで入力してください（負数・小数は非対応）。'); return; }
  if (BigInt(raw) < 2n) { showError('2 以上の整数を入力してください。'); return; }

  if (worker) worker.terminate();
  worker = new Worker('factorizer.worker.js');
  worker.onmessage = onWorkerMessage;
  worker.onerror = (ev) => {
    showError('Worker でエラーが発生しました: ' + ev.message);
    finish();
  };

  setRunning(true);
  worker.postMessage({ value: raw });
}

function finish() {
  setRunning(false);
  if (worker) { worker.terminate(); worker = null; }
}

function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'progress') {
    renderProgress(msg);
  } else if (msg.type === 'done') {
    renderResult(msg);
    finish();
  } else if (msg.type === 'error') {
    showError(msg.message);
    finish();
  }
}

function renderProgress(m) {
  progressCard.classList.remove('hidden');

  if (m.phase === 'trial') {
    const d = group(m.detail.divisor);
    $('phase').innerHTML = '<strong>試し割り</strong> — ' + d + ' まで確認しました';
  } else {
    $('phase').innerHTML = '<strong>Pollard&#39;s rho 法</strong> — ' +
      m.detail.digits + ' 桁の合成数を分解中（' + m.detail.iter + ' 回目の反復）';
  }

  if (typeof m.percent === 'number') {
    barEl.classList.remove('indeterminate');
    barFill.style.width = m.percent.toFixed(2) + '%';
  } else {
    barEl.classList.add('indeterminate');
  }

  $('p-elapsed').textContent = fmtDuration(m.elapsed);
  $('p-found').textContent = m.found.length ? m.found.map(group).join(' , ') : 'なし';
  const rem = m.detail.remaining;
  $('p-remain').textContent = rem === '1' ? '（完了）'
    : rem.length > 40 ? rem.slice(0, 40) + '…（' + rem.length + ' 桁）'
    : group(rem);
}

function renderResult(m) {
  progressCard.classList.add('hidden');
  resultCard.classList.remove('hidden');

  // 素因数を (値, 指数) にまとめる
  const groups = [];
  for (const f of m.factors) {
    const last = groups[groups.length - 1];
    if (last && last.v === f) last.e++;
    else groups.push({ v: f, e: 1 });
  }

  const n = inputEl.value.trim().replace(/[,\s_]/g, '');
  $('prime-note').classList.toggle('hidden', groups.length !== 1 || groups[0].e !== 1);

  const parts = groups.map(g =>
    '<span class="num">' + group(g.v) + '</span>' + (g.e > 1 ? '<sup>' + g.e + '</sup>' : '')
  );
  $('factored').innerHTML = group(n) + '<span class="op">=</span>' + parts.join('<span class="op">×</span>');

  const tbody = $('table').querySelector('tbody');
  tbody.innerHTML = '';
  for (const g of groups) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + group(g.v) + '</td><td>' + g.e + '</td><td>' + g.v.length + '</td>';
    tbody.appendChild(tr);
  }

  $('elapsed').textContent = fmtDuration(m.elapsed);

  // 検算: 素因数の積が入力値に戻るか
  let product = 1n;
  for (const f of m.factors) product *= BigInt(f);
  $('verify').textContent = product === BigInt(n)
    ? '（検算 OK: 積が入力値と一致）'
    : '（検算 NG: 積が一致しません）';
}

runBtn.addEventListener('click', start);
inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
cancelBtn.addEventListener('click', () => {
  finish();
  $('phase').innerHTML = '<strong>中止しました</strong>';
  barEl.classList.remove('indeterminate');
});
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    inputEl.value = btn.dataset.v;
    start();
  });
});
