import { GoogleGenerativeAI } from '@google/generative-ai'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Load KEY=VALUE from .env / .env.local without extra deps */
function loadEnvFile(filename) {
  try {
    const text = readFileSync(resolve(process.cwd(), filename), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    /* file optional */
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const API_KEY = process.env.GEMINI_API_KEY

if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set (check .env or .env.local)')
  process.exit(1)
}

async function testGemini() {
  try {
    console.log('Testing Gemini API key with @google/generative-ai...')
    const genAI = new GoogleGenerativeAI(API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
    const result = await model.generateContent(
      'Reply with exactly: Gemini API is working',
    )
    const text = result.response.text()
    console.log('API key is working!')
    console.log('Response:', text)
  } catch (error) {
    console.error('Gemini API key test failed')
    console.error('Error:', error instanceof Error ? error.message : error)
    if (error && typeof error === 'object' && 'status' in error) {
      console.error('Status:', error.status)
    }
  }
}

testGemini()
