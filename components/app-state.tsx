"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { defaultCandidateProfile, extractCandidateProfile } from "@/lib/ai";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const storedProfile = window.localStorage.getItem("stealth.profile");
    const storedSaved = window.localStorage.getItem("stealth.savedJobs");
    if (storedProfile) setProfile(normalizeProfile(JSON.parse(storedProfile)));
    if (storedSaved) setSavedJobs(JSON.parse(storedSaved));

    async function loadSupabaseState() {
      const supabase = createBrowserSupabaseClient();
      if (!supabase) return;

      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) return;

      const [profileResponse, savedJobsResponse] = await Promise.all([
        fetch("/api/profile", { cache: "no-store" }),
        fetch("/api/saved-jobs", { cache: "no-store" })
      ]);

      if (profileResponse.ok) {
        const result = (await profileResponse.json()) as { profile?: CandidateProfile };
        if (result.profile) setProfile(normalizeProfile(result.profile));
      }

      if (savedJobsResponse.ok) {
        const result = (await savedJobsResponse.json()) as { savedJobs?: SavedMap };
        if (result.savedJobs) setSavedJobs(result.savedJobs);
      }
    }

    void loadSupabaseState().finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("stealth.profile", JSON.stringify(profile));
  }, [hydrated, profile]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem("stealth.savedJobs", JSON.stringify(savedJobs));
  }, [hydrated, savedJobs]);

  const persistProfile = useCallback(async (nextProfile: CandidateProfile) => {
    try {
      await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: nextProfile })
      });
    } catch {
      // Local storage remains the offline fallback.
    }
  }, []);

  const persistSavedJob = useCallback(async (jobId: string, status: SavedStatus) => {
    try {
      await fetch("/api/saved-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status })
      });
    } catch {
      // Local storage remains the offline fallback.
    }
  }, []);

  const deleteSavedJob = useCallback(async (jobId: string) => {
    try {
      await fetch("/api/saved-jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId })
      });
    } catch {
      // Local storage remains the offline fallback.
    }
  }, []);

  const value = useMemo<AppState>(
    () => ({
      profile,
      savedJobs,
      updateResume: (resumeText) => {
        const nextProfile = extractCandidateProfile(resumeText);
        setProfile(nextProfile);
        void persistProfile(nextProfile);
      },
      updateProfile: (nextProfile) => {
        setProfile(nextProfile);
        void persistProfile(nextProfile);
      },
      setJobStatus: (jobId, status) => {
        setSavedJobs((current) => ({ ...current, [jobId]: status }));
        void persistSavedJob(jobId, status);
      },
      removeSavedJob: (jobId) => {
        setSavedJobs((current) => {
          const next = { ...current };
          delete next[jobId];
          return next;
        });
        void deleteSavedJob(jobId);
      }
    }),
    [deleteSavedJob, persistProfile, persistSavedJob, profile, savedJobs]
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
