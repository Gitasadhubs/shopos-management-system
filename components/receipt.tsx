'use client'

import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { money } from '@/components/page-kit'
import { formatDateTime, formatReceiptNumber } from '@/lib/format'
import { t } from '@/lib/i18n'

// The printed receipt, used by the POS after a sale and by Sales to print one again.
// Printing shows only .print-receipt (app/globals.css).

export type ReceiptSale = {
  id: string
  number?: number
  total: number
  discount?: number
  payment_method: string
  amount_paid?: number
  change_given?: number
  credit_amount?: number
  refunded?: number
  customer_name?: string | null
  created_by_name?: string | null
  created_at: string
  items: Array<{ product_name: string; quantity: number; unit_price?: number; subtotal: number; returned_quantity?: number }>
}
export type ShopProfile = { name: string; phone: string | null; address: string | null; receipt_footer: string | null }

// Numbered the country's way (lib/countries receipt: "#42", "INV-000042").
export const receiptLabel = (sale: { id: string; number?: number }) => (sale.number ? formatReceiptNumber(sale.number) : `#${sale.id.slice(0, 8)}`)

// 'returned' once every item has come back, 'partial' after some have.
export function returnStatus(sale: Pick<ReceiptSale, 'items'>) {
  if (!sale.items.some((item) => item.returned_quantity)) return null
  return sale.items.every((item) => (item.returned_quantity ?? 0) >= item.quantity) ? 'returned' : 'partial'
}

export function ReturnBadge({ sale }: { sale: Pick<ReceiptSale, 'items'> }) {
  const status = returnStatus(sale)
  if (!status) return null
  return <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === 'returned' ? 'bg-rose-100 text-rose-700' : 'bg-orange-100 text-orange-800'}`}>{t(status === 'returned' ? 'receipt.returned' : 'receipt.partReturned')}</span>
}

export function Receipt({ sale, shop, onPrint, copy = false, className = 'mt-4' }: { sale: ReceiptSale; shop: ShopProfile | null; onPrint: () => void; copy?: boolean; className?: string }) {
  return (
    <Card className={`print-receipt border-dashed shopos-pop ${className}`}>
      <CardContent className="p-5 font-mono text-xs">
        <div className="text-center">
          <p className="text-sm font-bold">{shop?.name ?? 'ShopOS'}</p>
          {shop?.address && <p className="text-muted-foreground">{shop.address}</p>}
          {shop?.phone && <p className="text-muted-foreground">{shop.phone}</p>}
          <p className="mt-1 text-muted-foreground">{t('pos.receipt', { number: receiptLabel(sale) })} · {formatDateTime(sale.created_at)}</p>
          {sale.created_by_name && <p className="text-muted-foreground">{t('receipt.servedBy', { name: sale.created_by_name })}</p>}
          {copy && <p className="mt-1 font-bold">{t('receipt.duplicate')}</p>}
        </div>
        <div className="my-3 border-t border-dashed" />
        {sale.items.map((item) => <div key={item.product_name}>
          <div className="flex justify-between gap-2"><span className="truncate">{item.product_name}</span><span className="shrink-0">{item.quantity} @ {money(item.unit_price ?? item.subtotal / item.quantity)}</span></div>
          {Boolean(item.returned_quantity) && <p className="text-right text-muted-foreground">{t('receipt.returnedQty', { count: item.returned_quantity ?? 0 })}</p>}
        </div>)}
        <div className="my-3 border-t border-dashed" />
        {Boolean(sale.discount) && <div className="flex justify-between"><span>{t('receipt.discount')}</span><span>−{money(sale.discount!)}</span></div>}
        <div className="flex justify-between text-sm font-bold"><span>{t('receipt.total')}</span><span>{money(sale.total)}</span></div>
        <div className="flex justify-between"><span>{t('receipt.paid', { method: t(`receipt.method.${sale.payment_method}`) })}</span><span>{money(sale.amount_paid ?? sale.total)}</span></div>
        {Boolean(sale.change_given) && <div className="flex justify-between"><span>{t('receipt.change')}</span><span>{money(sale.change_given!)}</span></div>}
        {Boolean(sale.credit_amount) && <div className="flex justify-between font-semibold"><span>{t('receipt.onAccount')}{sale.customer_name ? ` (${sale.customer_name})` : ''}</span><span>{money(sale.credit_amount!)}</span></div>}
        {Boolean(sale.refunded) && <div className="flex justify-between font-semibold"><span>{t('receipt.refunded')}</span><span>−{money(sale.refunded!)}</span></div>}
        <p className="mt-3 text-center text-muted-foreground">{shop?.receipt_footer || t('receipt.thanks')}</p>
        <Button variant="outline" size="sm" className="no-print mt-4 w-full font-sans" onClick={onPrint}><Printer className="mr-2 size-4" />{t('receipt.print')}</Button>
      </CardContent>
    </Card>
  )
}
