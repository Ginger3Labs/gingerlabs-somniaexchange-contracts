export const formatToDecimals = (inputNumber: number) => {
    const truncateToDecimalPlaces = (value: number, decimalPlaces: number): number => {
        if (!Number.isFinite(value)) return 0;
        const factor = Math.pow(10, decimalPlaces);
        const scaled = value * factor;
        // Truncate toward zero so the formatted value never exceeds the original (no rounding up)
        const adjusted = value >= 0 ? Math.floor(scaled) : Math.ceil(scaled);
        return adjusted / factor;
    };

    if (inputNumber === 0) return "0";

    // For very large numbers (>= 10000), show no decimals (truncate, don't round)
    if (Math.abs(inputNumber) >= 10000) {
        const truncated = truncateToDecimalPlaces(inputNumber, 0);
        return new Intl.NumberFormat('tr-TR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(truncated);
    }

    // For very small numbers (< 0.001), show as "0.000<1"
    if (Math.abs(inputNumber) < 0.001) {
        return "0.000<1";
    }

    // For very small numbers (< 0.0001), show up to 10 decimals (truncate)
    if (Math.abs(inputNumber) < 0.0001) {
        const truncated = truncateToDecimalPlaces(inputNumber, 10);
        return new Intl.NumberFormat('tr-TR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 10,
            useGrouping: false
        }).format(truncated);
    }

    // For numbers >= 0.01, show up to 4 decimal places (truncate)
    if (Math.abs(inputNumber) >= 0.01) {
        const truncated = truncateToDecimalPlaces(inputNumber, 4);
        return new Intl.NumberFormat('tr-TR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4
        }).format(truncated);
    }

    // For numbers between 0.0001 and 0.01, show up to 6 decimals (truncate)
    const truncated = truncateToDecimalPlaces(inputNumber, 6);
    return new Intl.NumberFormat('tr-TR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6
    }).format(truncated);
}