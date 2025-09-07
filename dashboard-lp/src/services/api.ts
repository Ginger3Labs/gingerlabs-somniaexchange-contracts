export async function withdrawLiquidity(params: {
    pairAddress: string;
    token0Address: string;
    token1Address: string;
    percentage: number;
    totalValueUSD: number;
    targetTokenAddress: string;
}) {
    const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.message || 'İşlem başarısız oldu.');
    }

    return result;
}

export async function logout() {
    const response = await fetch('/api/logout', { method: 'POST' });
    if (!response.ok) {
        throw new Error('Failed to log out');
    }
    return response;
}

