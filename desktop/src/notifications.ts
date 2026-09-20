import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

export async function ensureNotificationPermission() {
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

export async function notifyFinding(title: string, body: string) {
  if (!(await ensureNotificationPermission())) return false
  sendNotification({ title, body })
  return true
}
