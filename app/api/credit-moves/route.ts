import { NextResponse } from 'next/server'
export async function POST(request: Request) { const body = await request.json(); if (!body.client_id || !body.customer_id || typeof body.amount !== 'number') return NextResponse.json({ error: 'Invalid credit move' }, { status: 400 }); return NextResponse.json({ data: { client_id: body.client_id }, error: null }, { status: 201 }) }
