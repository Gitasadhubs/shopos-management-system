import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getPool, iso, LocalDataError, roundMoney } from '@/lib/local-db'

// Money spent running the shop. Each expense belongs to a calendar day in the shop's time zone, so
// day-end reports and net profit line up with the day the owner sees.

export const EXPENSE_CATEGORIES = ['Rent', 'Electricity & gas', 'Salaries', 'Transport', 'Tea & food', 'Repairs', 'Supplies', 'Other'] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]
export type Expense = { id: string; category: string; amount: number; note: string | null; spent_on: string; created_by_name: string | null; created_at: string }

// DATE values come back as midnight UTC (the pool uses timezone 'Z'), so the ISO date is the stored day.
const dayOf = (value: Date | string) => iso(value).slice(0, 10)

export async function listExpenses(shopId: string, from: string, to: string) {
  const [rows] = await (await getPool()).query<RowDataPacket[]>(
    `SELECT expenses.*, users.full_name AS created_by_name FROM expenses LEFT JOIN users ON users.id = expenses.created_by
     WHERE expenses.shop_id = ? AND expenses.spent_on BETWEEN ? AND ? ORDER BY expenses.spent_on DESC, expenses.created_at DESC LIMIT 500`,
    [shopId, from, to],
  )
  const expenses = rows.map((row): Expense => ({ id: row.id, category: row.category, amount: Number(row.amount), note: row.note, spent_on: dayOf(row.spent_on), created_by_name: row.created_by_name, created_at: iso(row.created_at) }))
  const byCategory = new Map<string, number>()
  for (const expense of expenses) byCategory.set(expense.category, roundMoney((byCategory.get(expense.category) ?? 0) + expense.amount))
  return {
    expenses,
    total: roundMoney(expenses.reduce((sum, expense) => sum + expense.amount, 0)),
    byCategory: [...byCategory.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
  }
}

export async function expensesTotal(shopId: string, from: string, to: string) {
  const [[row]] = await (await getPool()).query<RowDataPacket[]>('SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE shop_id = ? AND spent_on BETWEEN ? AND ?', [shopId, from, to])
  return roundMoney(Number(row.total))
}

export async function createExpense(shopId: string, input: { category: string; amount: number; note?: string; spent_on: string }, actorId: string) {
  const id = randomUUID()
  await (await getPool()).query(
    'INSERT INTO expenses (id, shop_id, category, amount, note, spent_on, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, shopId, input.category, roundMoney(input.amount), input.note?.trim() || null, input.spent_on, actorId, new Date()],
  )
  const [rows] = await (await getPool()).query<RowDataPacket[]>('SELECT * FROM expenses WHERE id = ?', [id])
  return { id, category: rows[0].category as string, amount: Number(rows[0].amount), note: rows[0].note as string | null, spent_on: dayOf(rows[0].spent_on) }
}

export async function deleteExpense(shopId: string, id: string) {
  const [result] = await (await getPool()).query<ResultSetHeader>('DELETE FROM expenses WHERE shop_id = ? AND id = ?', [shopId, id])
  if (!result.affectedRows) throw new LocalDataError('Expense not found.', 404)
}
