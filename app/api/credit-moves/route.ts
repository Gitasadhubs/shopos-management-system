import { NextResponse } from 'next/server'

// Customer credit is recorded through sales and customer payments (/api/customers/[id]/payment). This
// endpoint is left for older offline tills that still queue standalone credit moves: it declines them.
export async function POST() {
  return NextResponse.json({ data: null, error: 'Customer credit is recorded with sales and customer payments.' }, { status: 501 })
}
