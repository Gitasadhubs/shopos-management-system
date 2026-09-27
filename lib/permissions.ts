export type Role = 'owner' | 'manager' | 'cashier'
export const PERMISSIONS = {
  owner: ['*'],
  manager: ['dashboard.view', 'pos.*', 'inventory.*', 'customers.*', 'suppliers.*', 'purchases.*', 'reports.view', 'settings.view'],
  cashier: ['dashboard.view', 'pos.*', 'customers.view'],
} as const
export type Permission = 'dashboard' | 'pos' | 'inventory' | 'purchases' | 'customers' | 'suppliers' | 'reports' | 'settings' | 'users'
export function can(role: Role | null | undefined, permission: Permission) {
  if (!role) return false
  if (role === 'owner') return true
  if (role === 'cashier') return ['dashboard', 'pos', 'customers'].includes(permission)
  return true
}
