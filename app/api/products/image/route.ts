import { fileUrl } from '@/lib/file-keys'
import { readUpload, saveFile } from '@/lib/storage'
import { jsonResponse, withShop } from '@/lib/local-session'

export const runtime = 'nodejs'

// Stores a product photo and returns its URL; the product form then saves that URL as image_url.
export async function POST(request: Request) {
  return withShop(request, 'inventory', 'Unable to upload the photo.', async ({ shop }) => {
    const { upload } = await readUpload(request, 'products')
    return jsonResponse({ url: fileUrl(await saveFile(shop.id, 'products', upload)) }, null, 201)
  })
}
