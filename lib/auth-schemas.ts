import { z } from 'zod'
import { PASSWORD_MIN_LENGTH } from '@/lib/password'

export const emailField = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)
export const passwordField = z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).max(200, 'Use at most 200 characters.')
export const nameField = z.string().trim().min(1, 'Enter a name.').max(120)
export const tokenField = z.string().min(20).max(100)
export const staffRole = z.enum(['manager', 'cashier'])
