import { RateLimiterMemory } from 'rate-limiter-flexible';
import { NextRequest } from 'next/server';

// Rate limiter seçenekleri
const maxWrongAttemptsByIPperMinute = 10;
const maxWithdrawAttemptsByIPperMinute = 5;

const limiterSlowBruteByIP = new RateLimiterMemory({
    points: maxWrongAttemptsByIPperMinute,
    duration: 60, // Saniye cinsinden
    blockDuration: 60 * 10, // 10 dakika boyunca engelle
});

const limiterWithdrawByIP = new RateLimiterMemory({
    points: maxWithdrawAttemptsByIPperMinute,
    duration: 60, // Saniye cinsinden
    blockDuration: 60 * 5, // 5 dakika boyunca engelle
});

const getIp = (req: NextRequest) => {
    // Vercel gibi platformlar IP adresini bu header'da gönderir.
    // Birden fazla IP olabileceğinden (proxy zinciri), ilkini alırız.
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    // Alternatif olarak 'x-real-ip' header'ını kontrol et.
    const realIp = req.headers.get('x-real-ip');
    if (realIp) {
        return realIp.trim();
    }
    // Geliştirme ortamı için fallback.
    return '127.0.0.1';
};

export const rateLimiter = {
    checkLogin: (req: NextRequest) => limiterSlowBruteByIP.consume(getIp(req)),
    checkWithdraw: (req: NextRequest) => limiterWithdrawByIP.consume(getIp(req)),
};