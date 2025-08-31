"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            if (res.ok) {
                // Redirect to the dashboard on successful login
                router.push('/');
                router.refresh(); // Ensure the page reloads to check the cookie
            } else {
                const data = await res.json();
                setError(data.message || 'Login failed.');
            }
        } catch (err) {
            setError('An unexpected error occurred.');
            console.error(err);
        }
    };

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            background: '#111',
            color: 'white'
        }}>
            <form
                onSubmit={handleSubmit}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    padding: '2rem',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    background: '#222'
                }}
            >
                <h2>Admin Login</h2>
                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#333', color: 'white' }}
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#333', color: 'white' }}
                />
                <button
                    type="submit"
                    style={{ padding: '0.7rem', borderRadius: '4px', border: 'none', background: '#007bff', color: 'white', cursor: 'pointer' }}
                >
                    Login
                </button>
                {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
            </form>
        </div>
    );
}