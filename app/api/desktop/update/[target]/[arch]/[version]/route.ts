export const dynamic = 'force-dynamic'

export async function GET() {
  // No public desktop release has been promoted yet.
  // Tauri treats HTTP 204 as "no update available".
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}
