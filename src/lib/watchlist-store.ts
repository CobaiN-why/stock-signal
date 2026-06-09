"use client";

const STORAGE_KEY = "stock-signal-watchlist";

interface WatchlistData {
  sectorSlugs: string[];
  bloggerUsernames: string[];
}

function getWatchlistRaw(): WatchlistData {
  if (typeof window === "undefined") return { sectorSlugs: [], bloggerUsernames: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { sectorSlugs: [], bloggerUsernames: [] };
  } catch {
    return { sectorSlugs: [], bloggerUsernames: [] };
  }
}

function saveWatchlist(data: WatchlistData) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getWatchlist(): WatchlistData {
  return getWatchlistRaw();
}

export function isSectorWatched(slug: string): boolean {
  return getWatchlistRaw().sectorSlugs.includes(slug);
}

export function isBloggerWatched(username: string): boolean {
  return getWatchlistRaw().bloggerUsernames.includes(username);
}

export function addSector(slug: string) {
  const data = getWatchlistRaw();
  if (!data.sectorSlugs.includes(slug)) {
    data.sectorSlugs.push(slug);
    saveWatchlist(data);
  }
}

export function removeSector(slug: string) {
  const data = getWatchlistRaw();
  data.sectorSlugs = data.sectorSlugs.filter((s) => s !== slug);
  saveWatchlist(data);
}

export function addBlogger(username: string) {
  const data = getWatchlistRaw();
  if (!data.bloggerUsernames.includes(username)) {
    data.bloggerUsernames.push(username);
    saveWatchlist(data);
  }
}

export function removeBlogger(username: string) {
  const data = getWatchlistRaw();
  data.bloggerUsernames = data.bloggerUsernames.filter(
    (u) => u !== username
  );
  saveWatchlist(data);
}

export function getWatchlistCount(): number {
  const data = getWatchlistRaw();
  return data.sectorSlugs.length + data.bloggerUsernames.length;
}
