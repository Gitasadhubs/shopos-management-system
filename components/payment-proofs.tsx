import Link from 'next/link'
import { FileText } from 'lucide-react'
import { formatDateTime } from '@/lib/admin'
import type { PaymentProof } from '@/lib/local-platform'

// Payment proofs sent by shop owners, for the admin panel. Each opens the file in a new tab.
export function PaymentProofList({ proofs, showShop = false }: { proofs: PaymentProof[]; showShop?: boolean }) {
  return (
    <ul className="divide-y">{proofs.map((proof) => <li key={proof.id} className="flex items-center gap-4 px-5 py-3 text-sm">
      <a href={proof.url} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Open payment proof">
        {proof.content_type.startsWith('image/')
          ? <img src={proof.url} alt="Payment proof" className="size-14 rounded-lg border object-cover" />
          : <span className="flex size-14 items-center justify-center rounded-lg border bg-stone-50"><FileText className="size-6 text-stone-500" /></span>}
      </a>
      <div className="min-w-0 flex-1">
        {showShop && <Link href={`/admin/shops/${proof.shop_id}`} className="font-semibold hover:text-emerald-700">{proof.shop_name}</Link>}
        <p className="truncate text-stone-700">{proof.note || 'No note'}</p>
        <p className="text-xs text-stone-500">{formatDateTime(proof.created_at)}{proof.uploaded_by_name ? ` · ${proof.uploaded_by_name}` : ''}</p>
      </div>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${proof.reviewed_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{proof.reviewed_at ? 'Recorded' : 'Waiting'}</span>
    </li>)}</ul>
  )
}
