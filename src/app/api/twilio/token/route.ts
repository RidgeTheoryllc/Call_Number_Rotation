import { NextRequest, NextResponse } from "next/server";
import AccessToken from "twilio/lib/jwt/AccessToken";

const { VoiceGrant } = AccessToken;

export async function GET(req: NextRequest) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json(
      {
        error:
          "Missing one or more Twilio env vars: TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID",
      },
      { status: 500 },
    );
  }

  const identity = req.nextUrl.searchParams.get("identity") ?? "agent";
  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 3600,
    // Allow for minor server/client time skew to avoid immediate 20104 errors.
    nbf: Math.floor(Date.now() / 1000) - 10,
  });

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    }),
  );

  return NextResponse.json({ token: token.toJwt(), identity });
}
