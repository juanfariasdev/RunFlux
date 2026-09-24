// If the scanner ever imports this (it must not — this package lacks the
// "runflux.plugin" marker), the test should fail loudly rather than silently
// picking up a false positive.
throw new Error('unmarked-package must never be imported by the package scanner');
