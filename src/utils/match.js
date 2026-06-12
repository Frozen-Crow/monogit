function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a matcher from exact names or simple `*` globs (e.g. "release/*").
export function makeMatcher(patterns) {
  const regexes = (patterns || [])
    .filter(Boolean)
    .map((p) => new RegExp('^' + p.split('*').map(escapeRegex).join('.*') + '$'));
  return (name) => regexes.some((re) => re.test(name));
}
