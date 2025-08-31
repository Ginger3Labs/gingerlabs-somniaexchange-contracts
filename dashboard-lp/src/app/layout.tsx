import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Somnia LP Dashboard",
  description: "LP Position Dashboard for Somnia Network",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
