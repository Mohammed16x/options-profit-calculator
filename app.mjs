import { compute, normalizeNumber, parseDecimal } from './math.mjs?v=2';

const platformRates = { lite: '2.29', pro: '1.725' };
const defaults = { platform: 'pro', commission: '1.725', buy: '1.56', quantity: '3', sell: '1.85', target: '25', tick: '0.01', feeMode: 'both', mode: 'sell' };
const storageKey = 'options-profit-calculator:v1';
const byId = id => document.getElementById(id);
const ids = ['buy', 'quantity', 'sell', 'target', 'tick', 'commission'];
const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const priceFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const percentFormatter = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let mode = 'sell';
let current = null;
let toastTimer;

function amount(cents) {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '−' : ''}${integerFormatter.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
function money(cents) {
  const value = amount(cents);
  return value.startsWith('−') ? `−$${value.slice(1)}` : `$${value}`;
}
function price(units) { return priceFormatter.format(Number(units) / 10000); }
function percent(value) { return `${value > 0 ? '+' : value < 0 ? '−' : ''}${percentFormatter.format(Math.abs(value))}%`; }
function text(id, value) { byId(id).textContent = value; }

function getRaw() {
  return Object.fromEntries([
    ...ids.map(id => [id, byId(id).value]),
    ['platform', byId('platform')?.value ?? 'pro'],
    ['mode', mode],
    ['feeMode', document.querySelector('input[name="fee-mode"]:checked')?.value ?? 'both']
  ]);
}

function save(raw) { try { window.localStorage.setItem(storageKey, JSON.stringify(raw)); } catch {} }

function setMode(next, shouldRender = true) {
  mode = next === 'target' ? 'target' : 'sell';
  for (const value of ['sell', 'target']) {
    const selected = value === mode;
    byId(`tab-${value}`).setAttribute('aria-selected', String(selected));
    byId(`tab-${value}`).tabIndex = selected ? 0 : -1;
    byId(`panel-${value}`).hidden = !selected;
  }
  if (shouldRender) render();
}

function render() {
  const raw = getRaw();
  current = compute(raw);
  for (const id of ['buy', 'quantity', 'sell', 'target', 'commission']) {
    const message = current.errors[id];
    byId(id).setAttribute('aria-invalid', String(Boolean(message)));
    byId(`${id}-error`).hidden = !message;
    text(`${id}-error`, message ?? '');
  }
  for (const button of document.querySelectorAll('[data-target]')) {
    button.setAttribute('aria-pressed', String(normalizeNumber(raw.target) !== '' && Number(normalizeNumber(raw.target)) === Number(button.dataset.target)));
  }
  text('fee-explanation', raw.feeMode === 'both'
    ? `تقدير: ${normalizeNumber(raw.commission)} دولار لكل عقد عند الشراء ومثلها عند البيع. رسوم البيع مفترضة وقد تختلف.`
    : `تقدير: ${normalizeNumber(raw.commission)} دولار لكل عقد للصفقة كاملة.`);
  byId('decrease').disabled = parseDecimal(raw.quantity, 0) === 1n;
  byId('increase').disabled = parseDecimal(raw.quantity, 0) === 100000n;
  const card = byId('result-card');
  card.classList.toggle('invalid', !current.result);
  byId('copy-result').disabled = !current.result;
  byId('result-error').hidden = Boolean(current.result);
  if (!current.result) {
    card.classList.remove('loss');
    for (const id of ['headline', 'return-badge', 'buy-value', 'sale-value', 'gross-value', 'fee-value', 'net-value', 'breakeven-value']) text(id, '—');
    text('result-title', mode === 'target' ? 'سعر البيع لتحقيق هدفك' : 'صافي الربح بعد العمولة');
    text('fee-detail', '');
    text('return-label', 'بانتظار مدخلات صحيحة');
    byId('target-context').hidden = true;
    return;
  }
  const result = current.result;
  const loss = result.netCents < 0n;
  card.classList.toggle('loss', loss);
  text('result-title', mode === 'target' ? 'سعر البيع لتحقيق هدفك' : loss ? 'صافي الخسارة بعد العمولة' : 'صافي الربح بعد العمولة');
  const headline = mode === 'target' ? price(result.sellUnits) : amount(result.netCents);
  text('headline', headline);
  byId('headline').style.fontSize = headline.length > 11 ? 'clamp(25px, 5vw, 38px)' : headline.length > 8 ? 'clamp(35px, 7vw, 49px)' : '';
  text('return-badge', percent(result.returnPct));
  text('return-label', mode === 'target' ? 'العائد الصافي عند هذا السعر' : 'عائد صافٍ على قيمة الشراء');
  byId('target-context').hidden = mode !== 'target';
  if (mode === 'target') {
    const exact = result.exactTargetPrice.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    text('target-context', result.rounded
      ? `لتحقيق ${normalizeNumber(raw.target)}%: السعر المحسوب ${exact} دولار، مقرب للأعلى بخطوة ${raw.tick}.`
      : `هذا السعر يحقق هدف ${normalizeNumber(raw.target)}% بعد خصم العمولة.`);
  }
  text('buy-value', money(result.buyCents));
  text('sale-value', money(result.saleCents));
  text('gross-value', money(result.grossCents));
  text('fee-value', `−${money(result.feeCents)}`);
  text('fee-detail', `${integerFormatter.format(current.values.quantity)} × ${raw.feeMode === 'both' ? '2 × ' : ''}${normalizeNumber(raw.commission)}`);
  text('net-value', money(result.netCents));
  text('breakeven-value', `$${price(result.breakEvenUnits)}`);
  text('breakeven-note', `أقل سعر بخطوة ${raw.tick} يغطي العقود والعمولات.`);
  save(raw);
}

function hydrate(values) {
  if (byId('platform')) byId('platform').value = ['lite', 'pro', 'custom'].includes(values.platform) ? values.platform : Number(values.commission) === 2.29 ? 'lite' : Number(values.commission ?? defaults.commission) === 1.725 ? 'pro' : 'custom';
  for (const id of ids) byId(id).value = typeof values[id] === 'string' ? values[id] : defaults[id];
  if (!['0.01', '0.05', '0.10'].includes(byId('tick').value)) byId('tick').value = '0.01';
  for (const input of document.querySelectorAll('input[name="fee-mode"]')) input.checked = input.value === (values.feeMode === 'once' ? 'once' : 'both');
  setMode(values.mode, false);
  render();
}

function toast(message) {
  clearTimeout(toastTimer);
  text('toast', message);
  byId('toast').hidden = false;
  toastTimer = setTimeout(() => { byId('toast').hidden = true; }, 2600);
}

byId('platform')?.addEventListener('change', () => {
  const rate = platformRates[byId('platform').value];
  if (rate) byId('commission').value = rate;
  render();
});
byId('commission').addEventListener('input', () => {
  if (byId('platform')) {
    byId('platform').value = Object.keys(platformRates).find(key => Number(platformRates[key]) === Number(normalizeNumber(byId('commission').value))) ?? 'custom';
    render();
  }
});
for (const id of ids) byId(id).addEventListener(id === 'tick' ? 'change' : 'input', render);
for (const input of document.querySelectorAll('input[name="fee-mode"]')) input.addEventListener('change', render);
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => setMode(button.dataset.mode));
  button.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 'sell' : event.key === 'End' ? 'target' : mode === 'sell' ? 'target' : 'sell';
      setMode(next);
      byId(`tab-${next}`).focus();
    }
  });
}
for (const button of document.querySelectorAll('[data-target]')) button.addEventListener('click', () => { byId('target').value = button.dataset.target; render(); });
for (const [id, step] of [['increase', 1n], ['decrease', -1n]]) {
  byId(id).addEventListener('click', () => {
    const value = parseDecimal(byId('quantity').value, 0) ?? 1n;
    const next = value + step;
    byId('quantity').value = String(next < 1n ? 1n : next > 100000n ? 100000n : next);
    render();
  });
}
byId('reset-example').addEventListener('click', () => { hydrate(defaults); toast('تم تحميل المثال: شراء 1.56، بيع 1.85، وعدد 3 عقود'); });

byId('copy-result').addEventListener('click', async () => {
  if (!current?.result) return;
  const raw = getRaw();
  const result = current.result;
  const summary = [
    'ملخص صفقة الأوبشن',
    `المنصة: ${raw.platform === 'lite' ? 'Riyad Global Lite' : raw.platform === 'pro' ? 'Riyad Global Pro' : 'مخصص'}`,
    `سعر الشراء: $${price(current.values.buyUnits)}`,
    `سعر البيع: $${price(result.sellUnits)}`,
    `عدد العقود: ${current.values.quantity} | المضاعف: 100`,
    `العمولة: ${normalizeNumber(raw.commission)} لكل عقد ${raw.feeMode === 'both' ? 'عند الشراء وعند البيع' : 'للصفقة كاملة'}`,
    `إجمالي العمولة: ${money(result.feeCents)}`,
    `صافي الربح / الخسارة: ${money(result.netCents)}`,
    `العائد الصافي: ${percent(result.returnPct)} من قيمة الشراء قبل العمولة`,
    ...(mode === 'target' ? [`الهدف: ${normalizeNumber(raw.target)}% | خطوة تقريب سعر البيع: $${raw.tick}`] : [])
  ].join('\n');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(summary);
    else {
      const area = document.createElement('textarea');
      area.value = summary;
      area.style.cssText = 'position:fixed;top:-9999px;left:0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (!copied) throw new Error('Clipboard unavailable');
    }
    toast('تم نسخ ملخص الصفقة');
  } catch { toast('تعذر النسخ. يمكنك تحديد النتيجة ونسخها يدويًا.'); }
});

let saved = defaults;
try {
  const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const candidate = { ...defaults, ...parsed, platform: parsed.platform ?? (Number(parsed.commission ?? defaults.commission) === 2.29 ? 'lite' : Number(parsed.commission ?? defaults.commission) === 1.725 ? 'pro' : 'custom') };
    if (compute(candidate).result) saved = candidate;
  }
} catch {}
hydrate(saved);
