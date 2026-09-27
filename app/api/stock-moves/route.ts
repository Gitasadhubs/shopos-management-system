import { NextResponse } from 'next/server'
export async function POST(request: Request) { const body = await request.json(); if (!body.client_id || !body.product_id || typeof body.delta !== 'number') return NextResponse.json({ error: 'Invalid stock move' }, { status: 400 }); return NextResponse.json({ data: { client_id: body.client_id }, error: null }, { status: 201 }) }
