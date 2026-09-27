import { LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage } from '@/components/auth/auth-pages'
export function AuthPage({ type }: { type: 'login'|'signup'|'forgot-password'|'reset-password' }) { return type === 'login' ? <LoginPage/> : type === 'signup' ? <SignupPage/> : type === 'forgot-password' ? <ForgotPasswordPage/> : <ResetPasswordPage/> }
