import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inference Autopilot · Fleet laboratory',
  description:
    'Explore a heterogeneous inference fleet, simulate traffic surges, and approve guarded blue-green deployments.',
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
