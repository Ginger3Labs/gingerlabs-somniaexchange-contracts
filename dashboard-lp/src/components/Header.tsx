import { useRouter } from 'next/navigation';

interface HeaderProps {
    isLoading: boolean;
    onRefresh: () => void;
    onHardRefresh: () => void;
}

export function Header({ isLoading, onRefresh, onHardRefresh }: HeaderProps) {
    const router = useRouter();

    const handleLogout = async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            router.push('/login');
        } catch (error) {
            console.error('Failed to log out', error);
        }
    };

    return (
        <div className="bg-gray-800/80 backdrop-blur-lg rounded-2xl shadow-2xl border border-gray-700/50 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 border-b border-gray-700/50 p-8">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                    <div className="flex-1">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                                <span className="text-2xl font-bold">LP</span>
                            </div>
                            <div>
                                <h1 className="text-4xl font-extrabold bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 text-transparent bg-clip-text animate-gradient">
                                    Somnia LP Dashboard
                                </h1>
                                <p className="text-gray-400 mt-1">Likidite Havuzu Yönetim Paneli</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 bg-gray-900/40 backdrop-blur px-4 py-2 rounded-xl border border-gray-700/30">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></div>
                                <span className={`font-medium ${isLoading ? 'text-yellow-400' : 'text-green-400'}`}>
                                    {isLoading ? 'Yükleniyor...' : 'Hazır'}
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onRefresh}
                                disabled={isLoading}
                                className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-medium p-2 rounded-lg border border-blue-500/30 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                            </button>
                            <button
                                onClick={onHardRefresh}
                                className="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-medium p-2 rounded-lg border border-red-500/30 transition-all duration-300"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                            <button
                                onClick={handleLogout}
                                className="bg-gray-700/30 hover:bg-gray-700/50 text-gray-300 font-medium p-2 rounded-lg border border-gray-600/30 transition-all duration-300"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

