import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { defaultShopId, getCustomers } from '@/lib/db'

const schema = z.object({ name: z.string().min(1), phone: z.string().optional(), address: z.string().optional(), notes: z.string().optional() })
const json = (data: unknown, error: string | null = null, status = 200) => NextResponse.json({ data, error }, { status })
async function client() { const supabase = await createClient(); const { data } = await supabase.auth.getUser(); return { supabase, user: data.user } }

export async function GET(request: NextRequest) { try { const { user } = await client(); if (!user) return json(null, 'Authentication required', 401); return json(await getCustomers(request.nextUrl.searchParams.get('search') ?? undefined)) } catch { return json(null, 'Unable to load customers', 500) } }
export async function POST(request: NextRequest) { try { const { supabase, user } = await client(); if (!user) return json(null, 'Authentication required', 401); const input = schema.parse(await request.json()); const { data, error } = await supabase.from('customers').insert({ ...input, shop_id: defaultShopId() }).select().single(); if (error) throw error; return json(data, null, 201) } catch (error) { return json(null, error instanceof z.ZodError ? 'Invalid customer details' : 'Unable to create customer', 400) } }
