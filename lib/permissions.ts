export type Role = 'owner' | 'manager' | 'cashier'
export const permissions = {
  owner: { dashboard: true, pos: true, inventory: true, purchases: true, customers: true, suppliers: true, reports: true, settings: true, users: true },
  manager: { dashboard: true, pos: true, inventory: true, purchases: true, customers: true, suppliers: true, reports: true, settings: true, users: false },
  cashier: { dashboard: true, pos: true, inventory: false, purchases: false, customers: true, suppliers: false, reports: false, settings: false, users: false },
} as const
export function can(role: Role | null | undefined, permission: keyof typeof permissions.owner) { return !!role && permissions[role][permission] }
