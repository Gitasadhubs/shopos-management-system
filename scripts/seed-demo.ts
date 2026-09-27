import { createClient } from '@supabase/supabase-js'

const shopId = process.env.DEMO_SHOP_ID!
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const products = [['Basmati Rice 5kg',1850,1580,40,'Grocery'],['Chakki Atta 10kg',1200,1020,60,'Grocery'],['Sugar 1kg',140,118,200,'Grocery'],['Cooking Oil 5L',2400,2050,25,'Grocery'],['Daal Chana 1kg',280,235,80,'Grocery'],['Coca-Cola 1.5L',180,150,100,'Beverages'],['Tapal Danedar 950g',1650,1400,30,'Beverages'],['Nestle Milkpak 1L',320,265,60,'Beverages'],['Sooper Biscuits',60,48,150,'Snacks'],['Lays Masala',50,40,200,'Snacks'],['Dairy Milk Chocolate',150,120,80,'Snacks'],['Surf Excel 1kg',680,570,45,'Household'],['Lifebuoy Soap',120,95,100,'Household'],['Colgate 150g',280,230,60,'Household'],['Vaseline 100ml',280,230,50,'Personal']]
const customers = [['Muhammad Imran','+92-300-1111111',2450],['Fatima Bibi','+92-301-2222222',0],['Ali Hassan','+92-302-3333333',3800],['Ayesha Khan','+92-303-4444444',0],['Usman Malik','+92-304-5555555',1200],['Zainab Bibi','+92-305-6666666',0],['Bilal Ahmed','+92-306-7777777',0],['Sana Tariq','+92-307-8888888',0]]
async function main() {
  const { data: existing } = await supabase.auth.admin.listUsers()
  if (existing.users.some((user) => user.email?.toLowerCase() === 'demo@shopos.app')) { console.log('Demo data already exists'); return }
  const { data, error } = await supabase.auth.admin.createUser({ email: 'demo@shopos.app', password: 'DemoShop2026!', email_confirm: true })
  if (error || !data.user) throw error ?? new Error('Could not create demo user')
  const { error: roleError } = await supabase.from('user_roles').insert({ user_id: data.user.id, shop_id: shopId, role: 'owner', full_name: 'Ahmed Raza' })
  if (roleError) throw roleError
  const { error: shopError } = await supabase.from('shop_settings').upsert({ shop_id: shopId, name: 'Al-Madina Kirana Store', phone: '+92-300-1234567', address: 'Shop 12, Main Bazaar, Gulberg III, Lahore', currency: 'PKR', setup_completed: true, subscription_status: 'active' })
  if (shopError) throw shopError
  const { error: subscriptionError } = await supabase.from('subscriptions').upsert({ shop_id: shopId, plan: 'basic', status: 'active', current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), amount_pkr: 1500 })
  if (subscriptionError) throw subscriptionError
  const { error: productError } = await supabase.from('products').insert(products.map(([name, price, cost_price, stock_quantity, category]) => ({ shop_id: shopId, name, price, cost_price, stock_quantity, category })))
  if (productError) throw productError
  const { error: customerError } = await supabase.from('customers').insert(customers.map(([name, phone, credit_balance]) => ({ shop_id: shopId, name, phone, credit_balance })))
  if (customerError) throw customerError
  console.log('Demo data seeded')
}
main().catch((error) => { console.error(error); process.exit(1) })
