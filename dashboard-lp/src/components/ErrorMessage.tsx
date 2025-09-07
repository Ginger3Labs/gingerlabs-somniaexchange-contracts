interface ErrorMessageProps {
    error: string | null;
    txError: string | null;
    onClose: () => void;
}

export function ErrorMessage({ error, txError, onClose }: ErrorMessageProps) {
    if (!error && !txError) return null;

    return (
        <div className="w-full max-w-7xl mt-4 animate-fade-in">
            <div className="bg-red-900/20 backdrop-blur-sm border border-red-500/50 rounded-2xl p-6 flex items-center gap-4">
                <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <p className="text-red-400 flex-grow">{error || txError}</p>
                <button
                    onClick={onClose}
                    className="text-red-400 hover:text-red-300 transition-colors"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

