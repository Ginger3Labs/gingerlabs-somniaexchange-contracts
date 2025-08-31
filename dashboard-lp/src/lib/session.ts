import 'server-only';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const secretKey = process.env.SESSION_SECRET;
const encodedKey = new TextEncoder().encode(secretKey!);

export async function encrypt(payload: JWTPayload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1d')
        .sign(encodedKey);
}

export async function decrypt(session: string | undefined = ''): Promise<JWTPayload | null> {
    if (!session) return null;
    try {
        const { payload } = await jwtVerify(session, encodedKey, {
            algorithms: ['HS256'],
        });
        return payload;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
        console.log('Failed to verify session');
        return null;
    }
}