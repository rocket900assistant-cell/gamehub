// Hot-wallet sender: signs + broadcasts GRAM (native TON) payouts for approved
// withdrawals. Dormant unless HOT_TON_MNEMONIC is set. The seed lives ONLY in env.
import { TonClient, WalletContractV4, WalletContractV5R1, internal, toNano } from '@ton/ton'
import { mnemonicToPrivateKey } from '@ton/crypto'

let sender = null // { client, wallet, key, address }

export async function initSender() {
  const mnemonic = process.env.HOT_TON_MNEMONIC
  if (!mnemonic) {
    console.log('[hot] HOT_TON_MNEMONIC not set — auto-send disabled (approved withdrawals queue)')
    return null
  }
  try {
    const words = mnemonic.trim().split(/\s+/)
    const key = await mnemonicToPrivateKey(words)

    // Candidate wallet versions (Tonkeeper uses W5 = v5r1 by default now, older = v4r2).
    const candidates = [
      ['v5r1', WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey })],
      ['v4', WalletContractV4.create({ workchain: 0, publicKey: key.publicKey })],
    ]
    const addrs = (w) => [w.address.toString({ bounceable: false }), w.address.toString({ bounceable: true })]

    let ver, wallet, address
    const expected = process.env.HOT_TON_ADDRESS?.trim()
    if (expected) {
      // AUTO-DETECT the version by matching the address (no need to know v4 vs v5).
      const hit = candidates.find(([, w]) => addrs(w).includes(expected))
      if (!hit) {
        console.error(`[hot] seed does not derive HOT_TON_ADDRESS ${expected} (tried v5r1, v4). Check the seed/address. SENDER DISABLED.`)
        return null
      }
      ;[ver, wallet] = hit
      address = wallet.address.toString({ bounceable: false })
    } else {
      // No address given → fall back to a forced/default version (less safe).
      const forced = (process.env.HOT_WALLET_VERSION || 'v5r1').toLowerCase()
      ;[ver, wallet] = candidates.find(([v]) => v === forced) || candidates[0]
      address = wallet.address.toString({ bounceable: false })
      console.warn(`[hot] HOT_TON_ADDRESS not set — assuming ${ver} → ${address}. Set HOT_TON_ADDRESS to be safe.`)
    }

    const client = new TonClient({
      endpoint: process.env.TON_RPC || 'https://toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TONCENTER_KEY || undefined,
    })
    sender = { client, wallet, key, address }
    console.log(`[hot] sender ready: ${address} (${ver}, auto-detected)`)
    return sender
  } catch (e) {
    console.error('[hot] init failed:', e.message)
    return null
  }
}

export const senderReady = () => !!sender
export const hotAddress = () => sender?.address ?? null

/** Hot wallet balance in GRAM (native coin). */
export async function hotBalance() {
  if (!sender) return 0
  try {
    const b = await sender.client.getBalance(sender.wallet.address)
    return Number(b) / 1e9
  } catch (e) {
    console.error('[hot] balance failed:', e.message)
    return 0
  }
}

/** Sign + broadcast a payout. Returns the seqno used (idempotent per seqno). Throws on failure. */
export async function sendTon(toAddress, amountGram, comment = '') {
  if (!sender) throw new Error('sender not ready')
  const contract = sender.client.open(sender.wallet)
  const seqno = await contract.getSeqno()
  await contract.sendTransfer({
    seqno,
    secretKey: sender.key.secretKey,
    messages: [
      internal({
        to: toAddress,
        value: toNano(String(amountGram)),
        body: comment || undefined,
        bounce: false,
      }),
    ],
  })
  return { seqno }
}
