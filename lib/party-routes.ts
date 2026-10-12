import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { archiveParty, createParty, getPartyLedger, listParties, recordPartyPayment, updateParty } from '@/lib/local-business'
import { jsonResponse, parseBody, withShop } from '@/lib/local-session'
import type { Permission } from '@/lib/permissions'

// Route handlers shared by customers (khata) and suppliers in self-hosted mode.

export const partySchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(160),
  phone: z.string().trim().max(40).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
})

export const partyPaymentSchema = z.object({
  amount: z.coerce.number().finite().positive('Enter an amount above zero.').max(1_000_000_000),
  note: z.string().trim().max(300).optional().default(''),
})

type Table = 'customers' | 'suppliers'
type Params = { params: Promise<{ id: string }> }
const PERMISSION: Record<Table, Permission> = { customers: 'customers', suppliers: 'suppliers' }
const NAME = { customers: 'customer', suppliers: 'supplier' } as const

async function partyId({ params }: Params, table: Table) {
  const id = (await params).id
  return z.string().uuid().safeParse(id).success ? id : jsonResponse(null, `${NAME[table][0].toUpperCase()}${NAME[table].slice(1)} not found.`, 404)
}

export function listRoute(table: Table) {
  return (request: NextRequest) => withShop(request, PERMISSION[table], `Unable to load ${table}.`, async ({ shop }) =>
    jsonResponse(await listParties(table, shop.id, request.nextUrl.searchParams.get('search') ?? '')))
}

export function createRoute(table: Table) {
  return (request: Request) => withShop(request, PERMISSION[table], `Unable to save the ${NAME[table]}.`, async ({ shop }) => {
    const body = await parseBody(request, partySchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await createParty(table, shop.id, body.data), null, 201)
  })
}

export function detailRoute(table: Table) {
  return (request: Request, context: Params) => withShop(request, PERMISSION[table], `Unable to load the ${NAME[table]}.`, async ({ shop }) => {
    const id = await partyId(context, table)
    if (id instanceof NextResponse) return id
    return jsonResponse(await getPartyLedger(table, shop.id, id))
  })
}

export function updateRoute(table: Table) {
  return (request: Request, context: Params) => withShop(request, PERMISSION[table], `Unable to save the ${NAME[table]}.`, async ({ shop }) => {
    const id = await partyId(context, table)
    if (id instanceof NextResponse) return id
    const body = await parseBody(request, partySchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await updateParty(table, shop.id, id, body.data))
  })
}

export function archiveRoute(table: Table) {
  return (request: Request, context: Params) => withShop(request, PERMISSION[table], `Unable to remove the ${NAME[table]}.`, async ({ shop, user }) => {
    // Cashiers can add customers and take payments, but not remove records.
    if (user.role === 'cashier') return jsonResponse(null, 'Your role does not allow this.', 403, 'forbidden')
    const id = await partyId(context, table)
    if (id instanceof NextResponse) return id
    await archiveParty(table, shop.id, id)
    return jsonResponse(true)
  })
}

export function paymentRoute(table: Table) {
  return (request: Request, context: Params) => withShop(request, PERMISSION[table], 'Unable to record the payment.', async ({ shop, user }) => {
    const id = await partyId(context, table)
    if (id instanceof NextResponse) return id
    const body = await parseBody(request, partyPaymentSchema)
    if (body instanceof NextResponse) return body
    return jsonResponse(await recordPartyPayment(table, shop.id, id, body.data, user.id), null, 201)
  })
}
