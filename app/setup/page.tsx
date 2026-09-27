import { Suspense } from 'react'
import SetupForm from './setup-form'

export default function Setup() {
  return <Suspense fallback={null}><SetupForm /></Suspense>
}
