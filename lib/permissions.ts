export type Role = 'owner' | 'manager' | 'cashier'
export const PERMISSIONS = {
  owner: ['*'],
  manager: ['dashboard.view', 'pos.*', 'returns.*', 'inventory.*', 'customers.*', 'suppliers.*', 'purchases.*', 'reports.view', 'settings.view'],
  cashier: ['dashboard.view', 'pos.*', 'customers.view'],
} as const
// returns: taking items back from a sale and refunding them.
export type Permission = 'dashboard' | 'pos' | 'returns' | 'inventory' | 'purchases' | 'customers' | 'suppliers' | 'reports' | 'expenses' | 'settings' | 'users' | 'billing'
// Accepts any role string: a platform admin ('admin') belongs to no shop, so it has no shop permissions.
export function can(role: Role | string | null | undefined, permission: Permission) {
  if (!role) return false
  if (role === 'owner') return true
  // Cashiers sell and look up sales, but refunds need a manager or the owner.
  if (role === 'cashier') return ['dashboard', 'pos', 'customers'].includes(permission)
  // Managers run the shop but cannot manage staff accounts or the subscription.
  return role === 'manager' && permission !== 'users' && permission !== 'billing'
}
