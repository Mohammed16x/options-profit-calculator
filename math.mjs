export const CONTRACT_MULTIPLIER = 100;
export const COMMISSION_CENTS = 229;

export function normalizeNumber(value) {
  return String(value ?? '').trim()
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[٫،,]/g, '.')
    .replace(/[\u200e\u200f\u061c]/g, '');
}

// Decimal strings become exact integers; no currency calculations use binary floats.
export function parseDecimal(value, places = 4) {
  const normalized = normalizeNumber(value);
  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > places || whole.length > 9) return null;
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
}

export function validate(raw) {
  const errors = {};
  const buyUnits = parseDecimal(raw.buy);
  const quantity = parseDecimal(raw.quantity, 0);
  if (buyUnits === null || buyUnits <= 0n || buyUnits > 1000000000n)
    errors.buy = 'أدخل سعر شراء أكبر من صفر، بحد أقصى 4 منازل عشرية.';
  if (quantity === null || quantity < 1n || quantity > 100000n)
    errors.quantity = 'أدخل عددًا صحيحًا من 1 إلى 100,000 عقد.';
  if (!['both', 'once'].includes(raw.feeMode)) errors.feeMode = 'اختر طريقة احتساب العمولة.';
  if (!['sell', 'target'].includes(raw.mode)) errors.mode = 'اختر طريقة الحساب.';
  const sellUnits = parseDecimal(raw.sell);
  const targetBps = parseDecimal(raw.target, 2);
  const tickUnits = parseDecimal(raw.tick);
  if (raw.mode === 'sell' && (sellUnits === null || sellUnits > 10000000000n))
    errors.sell = 'أدخل سعر بيع يساوي صفرًا أو أكثر، بحد أقصى 4 منازل عشرية.';
  if (raw.mode === 'target' && (targetBps === null || targetBps > 1000000n))
    errors.target = 'أدخل نسبة من 0% إلى 10,000%، بحد أقصى منزلتين عشريتين.';
  if (![100n, 500n, 1000n].includes(tickUnits)) errors.tick = 'اختر خطوة سعر صالحة.';
  if (Object.keys(errors).length) return { errors, values: null };
  return { errors, values: { buyUnits, quantity, sellUnits, targetBps, tickUnits, feeMode: raw.feeMode, mode: raw.mode } };
}

const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;

export function calculate(values) {
  const { buyUnits, quantity, feeMode, mode, tickUnits, targetBps } = values;
  // At a 100 multiplier, premium units (1/10,000 USD) × quantity = position cents.
  const buyCents = buyUnits * quantity;
  const feeCents = BigInt(COMMISSION_CENTS) * quantity * (feeMode === 'both' ? 2n : 1n);
  const breakEvenNumerator = buyCents + feeCents;
  const breakEvenUnits = ceilDiv(breakEvenNumerator, quantity * tickUnits) * tickUnits;
  let sellUnits = values.sellUnits;
  let exactTargetNumerator = null;
  let exactTargetDenominator = null;
  if (mode === 'target') {
    // Desired net ROI is measured against premiums paid, before commissions.
    exactTargetNumerator = buyCents * (10000n + targetBps) + feeCents * 10000n;
    exactTargetDenominator = quantity * 10000n;
    sellUnits = ceilDiv(exactTargetNumerator, exactTargetDenominator * tickUnits) * tickUnits;
  }
  const saleCents = sellUnits * quantity;
  const grossCents = saleCents - buyCents;
  const netCents = grossCents - feeCents;
  return {
    buyCents, saleCents, grossCents, feeCents, netCents, sellUnits, breakEvenUnits,
    returnPct: Number(netCents) / Number(buyCents) * 100,
    premiumReturnPct: Number(sellUnits - buyUnits) / Number(buyUnits) * 100,
    exactTargetPrice: exactTargetNumerator === null ? null : Number(exactTargetNumerator) / Number(exactTargetDenominator) / 10000,
    rounded: exactTargetNumerator !== null && sellUnits * exactTargetDenominator !== exactTargetNumerator,
    exactBreakEvenPrice: Number(breakEvenNumerator) / Number(quantity) / 10000
  };
}

export function compute(raw) {
  const validation = validate(raw);
  return { ...validation, result: validation.values ? calculate(validation.values) : null };
}
