interface FilterBarProps {
    searchTerm: string;
    onSearchChange: (value: string) => void;
    minValue: string;
    onMinValueChange: (value: string) => void;
    maxValue: string;
    onMaxValueChange: (value: string) => void;
    targetTokenSymbol: string;
}

export function FilterBar({
    searchTerm,
    onSearchChange,
    minValue,
    onMinValueChange,
    maxValue,
    onMaxValueChange,
    targetTokenSymbol
}: FilterBarProps) {
    return (
        <div className="mb-8 bg-gray-800/80 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-gray-700/50">
            <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-blue-400"></div>
                <h2 className="text-lg font-semibold text-white">Filtrele ve Sırala</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Token/Adres Ara</label>
                    <div className="relative">
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder="Token sembolü veya adres..."
                            className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                        />
                        <svg
                            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Minimum Değer ({targetTokenSymbol})</label>
                    <div className="relative">
                        <input
                            type="number"
                            value={minValue}
                            onChange={(e) => onMinValueChange(e.target.value)}
                            placeholder="Min değer..."
                            className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                        />
                        <svg
                            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4M4 12l6-6m-6 6l6 6" />
                        </svg>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-300">Maksimum Değer ({targetTokenSymbol})</label>
                    <div className="relative">
                        <input
                            type="number"
                            value={maxValue}
                            onChange={(e) => onMaxValueChange(e.target.value)}
                            placeholder="Max değer..."
                            className="w-full px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-700/30 focus:border-blue-500/50 focus:outline-none transition-colors pl-10"
                        />
                        <svg
                            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16m-6-6l6 6-6 6" />
                        </svg>
                    </div>
                </div>
            </div>
        </div>
    );
}

