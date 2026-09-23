import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const panelSource = readFileSync(fileURLToPath(new URL('./ConversationReviewPanel.tsx', import.meta.url)), 'utf8')
const backendSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/conversation_review.rs', import.meta.url)), 'utf8')
const importSource = readFileSync(fileURLToPath(new URL('../src-tauri/src/conversations.rs', import.meta.url)), 'utf8')

describe('local AI conversation review boundary', () => {
  it('requires deliberate file selection and explicit consent before reading an export', () => {
    expect(panelSource).toContain("title: 'Choose a conversation export to review locally'")
    expect(panelSource).toContain('disabled={!consent || busy}')
    expect(panelSource).toContain("invoke<ConversationReview>('conversation_review_import'")
    expect(panelSource).toContain('consent: true')
    expect(backendSource).toContain('if !consent')
    expect(backendSource).toContain('Explicit consent is required before reviewing an AI conversation export')
  })

  it('does not implement account scraping or credential extraction paths', () => {
    expect(panelSource).toContain('does not sign in to those services')
    expect(panelSource).toContain('read session cookies')
    expect(panelSource).toContain('there is no hosted-AI fallback')
    expect(backendSource).not.toContain('api.openai.com')
    expect(backendSource).not.toContain('claude.ai')
    expect(backendSource).not.toContain('gemini.google.com')
  })

  it('recognizes user-selected ChatGPT, Claude and Gemini exports locally', () => {
    expect(importSource).toContain('chatgpt-export')
    expect(importSource).toContain('claude-export')
    expect(importSource).toContain('gemini-activity-export')
    expect(importSource).toContain('gemini-json-export')
    expect(importSource).toContain('parses_gemini_activity_without_provider_scraping')
  })

  it('keeps findings advisory and evidence redaction in place', () => {
    expect(panelSource).toContain('RECOMMENDED HUMAN ACTION')
    expect(panelSource).toContain('CashPatch executed nothing')
    expect(backendSource).toContain('content redacted by CashPatch')
    expect(backendSource).toContain('Verify the invoice, payment reference and bank transaction manually')
    expect(backendSource).toContain('CashPatch vault')
  })
})
