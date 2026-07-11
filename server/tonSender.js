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
    const version = (process.env.HOT_WALLET_VERSION || 'v5r1').toLowerCase()
    const wallet =
      version === 'v4'
        ? WalletContractV4.create({ workchain: 0, publicKey: key.publicKey })
        : WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey })
    const uq = wallet.address.toString({ bounceable: false })
    const eq = wallet.address.toString({ bounceable: true })

    // Safety: if the owner gave the hot address, refuse to run on a mismatch
    // (wrong wallet version → would sign from an empty/other address).
    const expected = process.env.HOT_TON_ADDRESS?.trim()
    if (expected && expected !== uq && expected !== eq) {
      console.error(`[hot] derived ${uq} != HOT_TON_ADDRESS ${expected}. Check HOT_WALLET_VERSION. SENDER DISABLED.`)
      return null
    }
    const client = new TonClient({
      endpoint: process.env.TON_RPC || 'https://toncenter.com/api/v2/jsonRPC',
      apiKey: process.env.TONCENTER_KEY || undefined,
    })
    sender = { client, wallet, key, address: uq }
    console.log(`[hot] sender ready: ${uq} (${version})`)
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
