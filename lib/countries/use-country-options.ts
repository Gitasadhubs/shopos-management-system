'use client'

import { useEffect, useState } from 'react'
import { countryOptions } from './index'

// Every country for a picker, filled in after hydration (see pickerOptions in ./index).
export function useCountryOptions() {
  const [options, setOptions] = useState<Array<{ code: string; name: string }> | null>(null)
  useEffect(() => setOptions(countryOptions()), [])
  return options
}
