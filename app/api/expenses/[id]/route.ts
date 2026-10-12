import { z } from 'zod'
import { deleteExpense } from '@/lib/local-expenses'
import { jsonResponse, withShop } from '@/lib/local-session'

export const runtime = 'nodejs'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withShop(request, 'expenses', 'Unable to delete the expense.', async ({ shop }) => {
    const id = (await params).id
    if (!z.string().uuid().safeParse(id).success) return jsonResponse(null, 'Expense not found.', 404)
    await deleteExpense(shop.id, id)
    return jsonResponse(true)
  })
}
