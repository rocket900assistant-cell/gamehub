// Pure GRAM stake settlement — no I/O, so it's easy to unit-test for conservation.
// Model (agreed with the owner):
//   • Every player stakes S. Pot = N·S.
//   • Only the LOSER (дурак / the beaten side) forfeits their stake.
//   • Owner fee = feeRate × S (10% of the loser's stake) — "10% from the loser".
//   • The loser's remaining (1−feeRate)·S is the PRIZE, split among the others by
//     finish order (1st out gets the most). Non-losers always get their stake back.
//   • Draw → everyone gets their stake back, no fee.
// 1v1 is just N=2 (winner = the single non-loser).

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100

/** Placement weights over `k` non-losers (1st → last). Defaults to 60/30/10, then 0. */
function normalizedWeights(k, base = [0.6, 0.3, 0.1]) {
  const w = Array.from({ length: k }, (_, i) => base[i] ?? 0)
  const sum = w.reduce((a, b) => a + b, 0) || 1
  return w.map((x) => x / sum)
}

/**
 * @param {object} o
 * @param {number} o.n           number of players
 * @param {number} o.stake       stake per player (GRAM)
 * @param {number|null} o.loserSeat  seat that lost; null = draw
 * @param {number[]} o.finishOrder   non-loser seats, in the order they finished (1st out first)
 * @param {number} [o.feeRate]   fraction of the loser's stake taken as fee (default 0.10)
 * @param {number[]} [o.weights] placement weights (default 60/30/10)
 * @returns {{ payouts: number[], fee: number }} payouts[seat] to credit; fee to the owner.
 *          Guaranteed: sum(payouts) + fee === n·stake  (fee absorbs any rounding).
 */
export function settleStakes({ n, stake, loserSeat, finishOrder = [], feeRate = 0.1, weights }) {
  const total = round2(n * stake)
  const payouts = Array(n).fill(0)

  if (loserSeat == null) {
    // draw → refund every stake, no fee
    for (let s = 0; s < n; s++) payouts[s] = round2(stake)
    return { payouts, fee: round2(total - payouts.reduce((a, b) => a + b, 0)) }
  }

  const prize = stake * (1 - feeRate) // loser's stake minus fee, split among finishers
  const order = finishOrder.filter((s) => s !== loserSeat)
  const w = normalizedWeights(order.length, weights)
  for (let i = 0; i < order.length; i++) {
    payouts[order[i]] = round2(stake + w[i] * prize)
  }
  payouts[loserSeat] = 0

  const paid = round2(payouts.reduce((a, b) => a + b, 0))
  const fee = round2(total - paid) // residual = owner fee (absorbs 2-decimal rounding)
  return { payouts, fee }
}

export { round2, normalizedWeights }
