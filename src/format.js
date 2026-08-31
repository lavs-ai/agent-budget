// src/format.js
export function formatUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  // Sub-cent estimates (very cheap LOW-tier calls) need more precision to
  // not all display as "$0.00" and look broken.
  const decimals = Math.abs(n) < 0.01 && n !== 0 ? 4 : 2;
  return '$' + n.toFixed(decimals);
}
