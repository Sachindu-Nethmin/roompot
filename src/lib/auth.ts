import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { connectDb } from "./db";
import { User } from "./models";

const COOKIE = "roompot_session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "dev-only-secret-change-me-in-production",
);

export async function setSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60d")
    .sign(secret);
  const jar = await cookies();
  // Secure cookies only work over HTTPS; behind a host's proxy the original scheme is in x-forwarded-proto.
  const proto = (await headers()).get("x-forwarded-proto") ?? "http";
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: proto.split(",")[0].trim() === "https",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** Returns the logged-in user document, or null. */
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    await connectDb();
    return await User.findById(payload.sub);
  } catch {
    return null;
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
