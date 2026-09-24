import { describe, expect, it } from 'vitest'
import { scanProgressView } from './scan-progress'

describe('Full Scan phase progress', () => {
  it('never presents capped inventory progress as 50% complete', () => {
    for (const progressPercent of [0, 50, 100]) {
      const view = scanProgressView({ workStage: 'inventory', paused: false, progressPercent })
      expect(view.percent).toBeUndefined()
      expect(view.label).toContain('total still being counted')
    }
  })
  it('identifies a pause separately from active work', () => {
    expect(scanProgressView({ workStage: 'inventory', paused: true, progressPercent: 50 }).label).toMatch(/^Paused/)
    expect(scanProgressView({ workStage: 'inventory', paused: false, progressPercent: 50 }).label).not.toMatch(/^Paused/)
  })
  it('shows a percentage only for the known document queue', () => {
    const view = scanProgressView({ workStage: 'documents', paused: false, progressPercent: 24.5 })
    expect(view.percent).toBe(24.5)
    expect(view.label).toContain('2/3 · Document review · 24.5%')
  })
  it('does not claim completion while system checks still run', () => {
    const view = scanProgressView({ workStage: 'finalizing', paused: false, progressPercent: 100 })
    expect(view.percent).toBeUndefined()
    expect(view.label).toContain('3/3')
  })
})
