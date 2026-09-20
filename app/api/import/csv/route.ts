import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseMoneyLeakCsv } from '@/lib/engine/csv'
import { scoreEvent } from '@/lib/engine/scoring'

export const runtime = 'nodejs'

export async function POST(request:Request){
  const supabase=await createClient()
  const {data:auth,error:authError}=await supabase.auth.getClaims()
  if(authError||!auth?.claims) return NextResponse.json({error:'Unauthorized'},{status:401})
  const {data:memberships}=await supabase.from('workspace_members').select('workspace_id').limit(1)
  const workspaceId=memberships?.[0]?.workspace_id
  if(!workspaceId) return NextResponse.json({error:'Workspace required'},{status:409})

  const form=await request.formData(); const file=form.get('file')
  if(!(file instanceof File)) return NextResponse.json({error:'CSV file required'},{status:400})
  if(file.size>2_000_000) return NextResponse.json({error:'CSV must be smaller than 2 MB'},{status:413})
  const text=await file.text()
  let events
  try{events=parseMoneyLeakCsv(text)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Invalid CSV'},{status:400})}

  const admin=createAdminClient(); const now=new Date().toISOString()
  const {data:source,error:sourceError}=await admin.from('source_connections').insert({workspace_id:workspaceId,provider:'csv',display_name:file.name,status:'connected',scopes:[]}).select('id').single()
  if(sourceError) return NextResponse.json({error:'Could not create import source'},{status:500})
  const {data:scan,error:scanError}=await admin.from('scan_runs').insert({workspace_id:workspaceId,source_connection_id:source.id,source_kind:'csv',status:'running'}).select('id').single()
  if(scanError) return NextResponse.json({error:'Could not start scan'},{status:500})

  let imported=0,findings=0,totalPotential=0
  try{
    for(const event of events){
      const fingerprint=createHash('sha256').update(JSON.stringify([event.type,event.counterparty,event.amount,event.currency,event.daysSilent,event.daysOverdue,event.paidAmount,event.previousAmount,event.renewalInDays,event.evidence])).digest('hex')
      const {data:moneyEvent,error:eventError}=await admin.from('money_events').upsert({workspace_id:workspaceId,source_connection_id:source.id,event_type:event.type,counterparty:event.counterparty,occurred_at:now,amount:event.amount??0,currency:event.currency,structured_payload:{days_silent:event.daysSilent,days_overdue:event.daysOverdue,paid_amount:event.paidAmount,previous_amount:event.previousAmount,renewal_in_days:event.renewalInDays},evidence_refs:event.evidence,source_fingerprint:fingerprint},{onConflict:'workspace_id,source_fingerprint',ignoreDuplicates:false}).select('id').single()
      if(eventError) throw eventError
      imported++
      const f=scoreEvent(event); totalPotential+=f.amount
      const {error:findingError}=await admin.from('findings').upsert({workspace_id:workspaceId,money_event_id:moneyEvent.id,finding_type:event.type,title:f.title,counterparty:f.counterparty,amount:f.amount,currency:f.currency,confidence:f.confidence,recoverability:f.recoverability,urgency:f.urgency,risk_score:f.riskScore,explanation:f.explanation,next_action:f.nextAction,evidence:f.evidence,status:'open',updated_at:now},{onConflict:'workspace_id,money_event_id'})
      if(findingError) throw findingError
      findings++
    }
    await admin.from('scan_runs').update({status:'completed',event_count:imported,finding_count:findings,total_potential:totalPotential,completed_at:new Date().toISOString()}).eq('id',scan.id)
    return NextResponse.json({ok:true,imported,findings,totalPotential})
  }catch(error){
    await admin.from('scan_runs').update({status:'failed',event_count:imported,finding_count:findings,error_message:error instanceof Error?error.message:'Import failed',completed_at:new Date().toISOString()}).eq('id',scan.id)
    return NextResponse.json({error:'Import failed'},{status:500})
  }
}
