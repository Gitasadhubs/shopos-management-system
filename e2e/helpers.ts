import { expect, type APIRequestContext, type Page } from '@playwright/test'

export type Product = {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  category: string | null
  unit: string
  sale_price: number
  cost_price: number
  stock_quantity: number
  reorder_level: number
}

export const isPreprod = process.env.E2E_TARGET === 'preprod'

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function uniqueCode(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
}

export async function createProduct(request: APIRequestContext, overrides: Partial<Omit<Product, 'id'>> & { name: string }) {
  const response = await request.post('/api/products', {
    data: { cost_price: 60, sale_price: 100, stock_quantity: 10, reorder_level: 2, ...overrides },
  })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()).data as Product
}

export async function getProduct(request: APIRequestContext, name: string) {
  const response = await request.get(`/api/products?search=${encodeURIComponent(name)}`)
  expect(response.ok()).toBe(true)
  const products = (await response.json()).data as Product[]
  return products.find((product) => product.name === name)
}

export async function salesFor(request: APIRequestContext, productName: string) {
  const response = await request.get('/api/sales')
  expect(response.ok()).toBe(true)
  const sales = (await response.json()).data as Array<{ id: string; total: number; payment_method: string; items: Array<{ product_name: string; quantity: number }> }>
  return sales.filter((sale) => sale.items.some((item) => item.product_name === productName))
}

// Collects uncaught page errors and console errors so tests can assert a page ran cleanly.
export function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  return errors
}
