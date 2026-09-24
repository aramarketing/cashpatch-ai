type ProgressSnapshot = { workStage?: string; paused: boolean; progressPercent: number }

export function scanProgressView(snapshot: ProgressSnapshot): { label: string; percent?: number } {
  const prefix = snapshot.paused ? 'Paused · ' : ''
  if (snapshot.workStage === 'documents') {
    const percent = Math.min(100, Math.max(0, snapshot.progressPercent))
    return { label: `${prefix}2/3 · Document review · ${percent.toFixed(1)}%`, percent }
  }
  if (snapshot.workStage === 'finalizing') {
    return { label: `${prefix}3/3 · System checks and report` }
  }
  return { label: `${prefix}1/3 · File inventory and checks · total still being counted` }
}
