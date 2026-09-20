import type { MoneyEventInput } from './csv'
export type ScoredFinding = MoneyEventInput & {title:string; amount:number; confidence:number; recoverability:number; urgency:number; riskScore:number; explanation:string; nextAction:string}
const clamp=(v:number,min=0,max=1)=>Math.min(max,Math.max(min,v))
const money=(value:number,currency:string)=>new Intl.NumberFormat('en-GB',{style:'currency',currency,maximumFractionDigits:0}).format(value)
export function scoreEvent(e:MoneyEventInput):ScoredFinding{
  let amount=e.amount||0, confidence=.7, recoverability=.7, urgency=.5, title='Potential money leak', explanation='This item deserves review.', nextAction='Review the evidence and decide the next step.'
  if(e.type==='lead_silent'){
    const d=e.daysSilent||0; confidence=clamp(.68+d*.035); recoverability=clamp(.84-d*.025); urgency=clamp(.45+d*.06); title='Lead waiting for a reply'; explanation=`${e.counterparty} has been silent for ${d} days after an active enquiry.`; nextAction='Draft a short follow-up that restarts the conversation.'
  }
  if(e.type==='quote_silent'){
    const d=e.daysSilent||0; confidence=clamp(.72+d*.02); recoverability=clamp(.82-d*.015); urgency=clamp(.5+d*.045); title='Quote may be going cold'; explanation=`A ${money(amount,e.currency)} quote to ${e.counterparty} has had no visible decision for ${d} days.`; nextAction='Draft a decision-oriented quote check-in.'
  }
  if(e.type==='invoice_overdue'){
    const d=e.daysOverdue||0; confidence=clamp(.82+Math.min(.16,d*.008)); recoverability=clamp(.9-Math.min(.3,d*.012)); urgency=clamp(.65+Math.min(.35,d*.018)); title='Invoice looks overdue'; explanation=`${money(amount,e.currency)} from ${e.counterparty} appears ${d} days overdue based on the available signals.`; nextAction='Draft a factual payment reminder for approval.'
  }
  if(e.type==='invoice_part_paid'){
    const paid=e.paidAmount||0; amount=Math.max(0,amount-paid); confidence=.94; recoverability=.88; urgency=.8; title='Possible partial payment'; explanation=`${money(paid,e.currency)} appears paid. ${money(amount,e.currency)} may still be outstanding.`; nextAction='Verify the payment signal, then draft a balance reminder.'
  }
  if(e.type==='vendor_renewal'){
    const d=e.renewalInDays??30; confidence=.88; recoverability=.62; urgency=clamp(1-d/45); title='Renewal needs a decision'; explanation=`${e.counterparty} appears set to renew in ${d} days for about ${money(amount,e.currency)}.`; nextAction='Review usage and keep, renegotiate, downgrade or cancel.'
  }
  if(e.type==='vendor_price_change'){
    const before=e.previousAmount||0,delta=before?(amount-before)/before*100:0; confidence=.91; recoverability=.55; urgency=.72; title='Vendor price increased'; explanation=`${e.counterparty} changed from ${money(before,e.currency)} to ${money(amount,e.currency)}${before?` (${delta.toFixed(0)}%)`:''}.`; nextAction='Review whether the increase is justified and prepare a renegotiation note.'
  }
  return {...e,title,amount,confidence,recoverability,urgency,riskScore:amount*confidence*recoverability*urgency,explanation,nextAction}
}
