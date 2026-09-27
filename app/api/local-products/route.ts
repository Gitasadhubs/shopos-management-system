import { DELETE as deleteProduct, GET as getProducts, POST as createProduct, PUT as updateProduct } from '../products/route'

export const runtime = 'nodejs'
export const GET = getProducts
export const POST = createProduct
export const PUT = updateProduct
export const DELETE = deleteProduct
