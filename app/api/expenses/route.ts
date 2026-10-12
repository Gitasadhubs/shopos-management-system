import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createExpense, EXPENSE_CATEGORIES, listExpenses } from '@/lib/local-expenses'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import { dayKey, dayRange } from '@/lib/time'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-01-31.').refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Invalid date.')

const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, 'Choose a category.'),
  amount: z.coerce.number().finite().positive('Enter an amount above zero.').max(1_000_000_000),
  note: z.string().trim().max(300).optional().default(''),
  spent_on: day,
})

// ?from=&to= (shop-local days). Defaults to the current month.
export async function GET(request: NextRequest) {
  return withShop(request, 'expenses', 'Unable to load expenses.', async ({ shop }) => {
    const today = dayKey(shop.timezone)
    const params = request.nextUrl.searchParams
    const from = day.safeParse(params.get('from') ?? `${today.slice(0, 7)}-01`)
    const to = day.safeParse(params.get('to') ?? today)
    if (!from.success || !to.success) return jsonResponse(null, 'Dates must look like 2026-01-31.', 400)
    if (from.data > to.data || dayRange(from.data, to.data).length > 366) return jsonResponse(null, 'Choose a range of up to a year, start before end.', 400)
    return jsonResponse({ ...(await listExpenses(shop.id, from.data, to.data)), from: from.data, to: to.data, categories: EXPENSE_CATEGORIES })
  })
}

export async function POST(request: Request) {
  return withShop(request, 'expenses', 'Unable to save the expense.', async ({ shop, user }) => {
    const body = await parseBody(request, expenseSchema)
    if (body instanceof NextResponse) return body
    if (body.data.spent_on > dayKey(shop.timezone)) return jsonResponse(null, 'An expense cannot be in the future.', 400)
    return jsonResponse(await createExpense(shop.id, body.data, user.id), null, 201)
  })
}
