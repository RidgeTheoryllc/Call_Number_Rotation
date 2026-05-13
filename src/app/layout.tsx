import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TwilioDeviceProvider } from "@/components/twilio-device-provider";
import { WorkspaceDataCacheProvider } from "@/components/workspace-data-cache";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Outbound Dialer Intelligence System",
  description: "Call orchestration and DID reputation management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <TwilioDeviceProvider>
          <WorkspaceDataCacheProvider>{children}</WorkspaceDataCacheProvider>
        </TwilioDeviceProvider>
      </body>
    </html>
  );
}
