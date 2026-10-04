// ---------------------------------------------------------------------------
// Browser / device support (W9-06 / BRD NFR-06).
//
// The NFR asks the SPA to work on the latest two versions of Chrome, Edge and
// Safari plus a tablet. This module holds the support matrix and the pure gate
// so the browser SIT harness and the unit tests share one definition of "pass".
// Chrome and Edge share the Chromium engine; Safari (WebKit) is recorded as
// external because it is not installable in the build environment.
// ---------------------------------------------------------------------------

export const BROWSER_SUPPORT_VERSION = 'NFR-06.1';

export const SUPPORTED_BROWSERS = [
  { id: 'chrome', engine: 'chromium', label: 'Chrome (latest 2)', tested: true },
  { id: 'edge', engine: 'chromium', label: 'Edge (latest 2)', tested: true },
  { id: 'safari', engine: 'webkit', label: 'Safari (latest 2)', tested: false, external: true },
];

export const DEVICE_PROFILES = [
  { id: 'chrome_desktop', engine: 'chromium', viewport: { width: 1440, height: 900 } },
  { id: 'edge_desktop', engine: 'chromium', viewport: { width: 1280, height: 800 } },
  { id: 'tablet_ipad', engine: 'chromium', viewport: { width: 820, height: 1180, isMobile: true, hasTouch: true } },
];

// A run passes when every tested profile rendered every journey without a page
// error. Profiles marked external are reported, not failed.
export function evaluateBrowserSit(profileResults = []) {
  const tested = profileResults.filter((r) => r.status !== 'external');
  const failed = tested.filter((r) => r.status !== 'pass');
  const external = profileResults.filter((r) => r.status === 'external');
  return {
    profiles_tested: tested.length,
    profiles_passed: tested.filter((r) => r.status === 'pass').length,
    profiles_failed: failed.length,
    external: external.length,
    pass: failed.length === 0 && tested.length > 0,
    policy: 'Every tested viewport profile must render the core journeys with no page errors.',
  };
}

export default { BROWSER_SUPPORT_VERSION, SUPPORTED_BROWSERS, DEVICE_PROFILES, evaluateBrowserSit };

