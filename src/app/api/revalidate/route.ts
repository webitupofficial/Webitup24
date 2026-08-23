import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { parseBody } from 'next-sanity/webhook';

export async function POST(req: NextRequest) {
  try {
    const { isValidSignature, body } = await parseBody<{
      _type: string;
      slug?: { current?: string };
    }>(req, process.env.SANITY_REVALIDATE_SECRET);

    if (!isValidSignature) {
      return new Response('Invalid secret signature', { status: 401 });
    }

    if (!body?._type) {
      return new Response('Bad Request: Missing _type', { status: 400 });
    }

    // Invalidate global tags and specific document types
    revalidateTag(body._type);

    return NextResponse.json({
      status: 200,
      revalidated: true,
      now: Date.now(),
      body,
    });
  } catch (err: any) {
    console.error('[Revalidate Webhook Error]', err);
    return new Response(err.message, { status: 500 });
  }
}
