import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inference Autopilot · Fleet laboratory',
  description:
    'Simulate Gemma 4 inference deployments, compare evidence, and approve better configurations.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
