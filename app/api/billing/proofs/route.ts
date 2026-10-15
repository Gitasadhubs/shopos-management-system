import { NextResponse } from 'next/server'
import { addPaymentProof, assertProofAllowance } from '@/lib/local-platform'
import { authorize, errorResponse, isSelfHosted, jsonResponse } from '@/lib/local-session'
import { can } from '@/lib/permissions'
import { deleteFile, readUpload, saveFile } from '@/lib/storage'

export const runtime = 'nodejs'

// The owner sends a screenshot (or PDF) of a subscription payment. Allowed while the shop is expired
// or suspended too: that is when it is needed.
export async function POST(request: Request) {
  if (!isSelfHosted()) return jsonResponse(null, 'Not found.', 404)
  try {
    const auth = await authorize(request)
    if (auth instanceof NextResponse) return auth
    if (!auth.user.shop || !can(auth.user.role, 'billing')) return jsonResponse(null, 'Your role does not allow this.', 403, 'forbidden')
    const shopId = auth.user.shop.id
    await assertProofAllowance(shopId)
    const { upload, form } = await readUpload(request, 'payment-proofs')
    const note = form.get('note')
    if (typeof note === 'string' && note.trim().length > 300) return jsonResponse(null, 'Keep the note under 300 characters.', 400)
    const key = await saveFile(shopId, 'payment-proofs', upload)
    try {
      return jsonResponse(await addPaymentProof(auth.user.id, shopId, { key, type: upload.type, size: upload.size }, typeof note === 'string' ? note : null), null, 201)
    } catch (error) {
      await deleteFile(key)
      throw error
    }
  } catch (error) {
    return errorResponse(error, 'Unable to send the payment proof.')
  }
}
