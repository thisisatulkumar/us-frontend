import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
    title: "Us",
    description: "Best platform to chill with your best friend",
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
