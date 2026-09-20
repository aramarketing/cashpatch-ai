'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function createWorkspace(formData: FormData) {
  const supabase = await createClient()
  const name = String(formData.get('name') ?? '').trim()
  const { error } = await supabase.rpc('create_workspace', { p_name: name })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard')
}

export async function updateFinding(formData: FormData) {
  const supabase = await createClient()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const allowed = new Set(['snoozed','dismissed','resolved'])
  if (!allowed.has(status)) throw new Error('Invalid status')
  const { error } = await supabase.from('findings').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard')
}
