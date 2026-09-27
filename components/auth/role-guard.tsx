'use client'

import { LockKeyhole } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from './auth-provider'
import { can, type Permission } from '@/lib/permissions'

export function RoleGuard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return null
  if (!can(role?.role, permission)) {
    return <Card className="mx-auto max-w-lg rounded-2xl border-stone-200 bg-white shadow-sm"><CardHeader className="items-center text-center"><div className="flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-700"><LockKeyhole /></div><CardTitle>Access restricted</CardTitle></CardHeader><CardContent className="text-center text-sm text-muted-foreground">This area is for shop owners and managers only.</CardContent></Card>
  }
  return <>{children}</>
}
