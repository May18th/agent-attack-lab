import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useCommittedRef } from './useCommittedRef'

describe('useCommittedRef', () => {
  it('updates the ref before later layout effects observe the committed value', () => {
    const observe = vi.fn()
    function Probe({ value }: { value: string }) {
      const valueRef = useCommittedRef(value)
      useLayoutEffect(() => { observe(valueRef.current) }, [value, valueRef])
      return null
    }

    const { rerender } = render(<Probe value="initial" />)
    rerender(<Probe value="committed" />)

    expect(observe).toHaveBeenLastCalledWith('committed')
  })
})
