interface LoadingMessageProps {
    isLoading: boolean;
    infoMessage: string;
}

export function LoadingMessage({ isLoading, infoMessage }: LoadingMessageProps) {
    if (!isLoading) return null;

    return (
        <div className="bg-blue-900/20 backdrop-blur-sm border border-blue-500/50 rounded-2xl p-6 mb-8 animate-fade-in">
            <div className="flex items-center gap-4">
                <div className="flex-shrink-0">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div className="flex-grow">
                    <p className="text-blue-400 text-lg">{infoMessage}</p>
                    <div className="w-full h-1 bg-blue-900/50 rounded-full mt-3 overflow-hidden">
                        <div
                            className="h-full bg-blue-500 rounded-full animate-pulse"
                            style={{ width: '50%' }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

