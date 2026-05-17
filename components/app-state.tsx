"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { defaultCandidateProfile, extractCandidateProfile } from "@/lib/ai";
import { CandidateProfile, SavedStatus } from "@/lib/types";

type SavedMap = Record<string, SavedStatus>;

type AppState = {
  profile: CandidateProfile;
  savedJobs: SavedMap;
  updateResume: (resumeText: string) => void;
  updateProfile: (profile: CandidateProfile) => void;
  setJobStatus: (jobId: string, status: SavedStatus) => void;
  removeSavedJob: (jobId: string) => void;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [profile, setProfile] = useState<CandidateProfile>(defaultCandidateProfile);
  const [savedJobs, setSavedJobs] = useState<SavedMap>({});

  useEffect(() => {
    const storedProfile = window.localStorage.getItem("stealth.profile");
    const storedSaved = window.localStorage.getItem("stealth.savedJobs");
    if (storedProfile) setProfile(normalizeProfile(JSON.parse(storedProfile)));
    if (storedSaved) setSavedJobs(JSON.parse(storedSaved));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("stealth.profile", JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    window.localStorage.setItem("stealth.savedJobs", JSON.stringify(savedJobs));
  }, [savedJobs]);

  const value = useMemo<AppState>(
    () => ({
      profile,
      savedJobs,
      updateResume: (resumeText) => setProfile(extractCandidateProfile(resumeText)),
      updateProfile: setProfile,
      setJobStatus: (jobId, status) => setSavedJobs((current) => ({ ...current, [jobId]: status })),
      removeSavedJob: (jobId) =>
        setSavedJobs((current) => {
          const next = { ...current };
          delete next[jobId];
          return next;
        })
    }),
    [profile, savedJobs]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used within AppStateProvider");
  return value;
}

function normalizeProfile(profile: Partial<CandidateProfile>): CandidateProfile {
  return {
    ...defaultCandidateProfile,
    ...profile,
    personality: {
      ...defaultCandidateProfile.personality,
      ...profile.personality
    }
  };
}
