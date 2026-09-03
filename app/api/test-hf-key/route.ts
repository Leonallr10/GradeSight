import { NextResponse } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  token: z.string().min(1, 'Token cannot be empty'),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Please provide a non-empty Hugging Face API key.' },
        { status: 400 },
      )
    }

    const token = parsed.data.token.trim()

    // Test token against official Hugging Face user info endpoint
    const hfRes = await fetch('https://huggingface.co/api/whoami-v2', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!hfRes.ok) {
      if (hfRes.status === 401) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'invalid_token',
            error:
              'Invalid or expired Hugging Face token. Please generate a valid token at huggingface.co/settings/tokens.',
          },
          { status: 401 },
        )
      }
      if (hfRes.status === 402) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'quota_exhausted',
            error:
              'Hugging Face quota or billing credits are exhausted for this account. Please add credits at huggingface.co/settings/billing or provide an active token.',
          },
          { status: 402 },
        )
      }
      if (hfRes.status === 403) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'permission_denied',
            error:
              'Token permissions insufficient. Please create a fine-grained token with "Make calls to Inference Providers" at huggingface.co/settings/tokens.',
          },
          { status: 403 },
        )
      }
      if (hfRes.status === 429) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'rate_limit',
            error:
              'Hugging Face API rate limit reached. This account/token has exceeded its request threshold. Please try another key or wait for the rate limit to reset.',
          },
          { status: 429 },
        )
      }
      if (hfRes.status >= 500) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'service_error',
            error: `Hugging Face service is temporarily unavailable (status ${hfRes.status}). Please check status.huggingface.co or try again shortly.`,
          },
          { status: hfRes.status },
        )
      }
      return NextResponse.json(
        {
          ok: false,
          error: `Hugging Face API returned error status ${hfRes.status}.`,
        },
        { status: hfRes.status },
      )
    }

    const data = (await hfRes.json()) as {
      name?: string
      fullname?: string
      type?: string
      email?: string
      auth?: { accessToken?: { displayName?: string; role?: string } }
    }

    return NextResponse.json({
      ok: true,
      user: data.name || data.fullname || 'Authenticated User',
      tokenName: data.auth?.accessToken?.displayName || 'API Token',
      role: data.auth?.accessToken?.role || 'active',
      message: `Token verified successfully for @${data.name || 'user'}!`,
    })
  } catch (err) {
    console.error('Error testing HF key:', err)
    return NextResponse.json(
      {
        ok: false,
        reason: 'network_error',
        error:
          err instanceof Error
            ? err.message
            : 'Failed to connect to Hugging Face API. Please check your internet connection.',
      },
      { status: 500 },
    )
  }
}
