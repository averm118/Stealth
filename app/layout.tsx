import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { AppStateProvider } from "@/components/app-state";

export const metadata: Metadata = {
  title: "Stealth | Resume-Aligned Internship Radar",
  description: "Find student-friendly internships and new-grad roles matched to your resume, sponsorship needs, and search goals.",
  openGraph: {
    title: "Stealth | Resume-Aligned Internship Radar",
    description: "A calm, resume-first radar for internships, new-grad roles, tailored resumes, and cover letters.",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Stealth | Resume-Aligned Internship Radar",
    description: "A calm, resume-first radar for internships, new-grad roles, tailored resumes, and cover letters."
  }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppStateProvider>
          <AppShell>{children}</AppShell>
        </AppStateProvider>
      </body>
    </html>
  );
}
