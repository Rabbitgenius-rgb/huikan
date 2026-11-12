'use strict';
// Verified builds are a record of evidence, not a runtime allowlist.
const VERIFIED_HARNESS_VERSIONS = Object.freeze(['0.2.0-rc.2', '0.2.1-rc.3', '0.2.2-rc.1']);
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function isHarnessVersion(version) { return typeof version === 'string' && version.length <= 64 && VERSION.test(version); }
function isVerifiedHarnessVersion(version) { return VERIFIED_HARNESS_VERSIONS.includes(version); }
function compatibleHarnessView(view) {
  return !!view && isHarnessVersion(view.version) && view.supported === true
    && (view.compatibility ? view.compatibility.protocol === 1 && view.compatibility.state === 'ready' : isVerifiedHarnessVersion(view.version));
}
module.exports = { VERIFIED_HARNESS_VERSIONS, isHarnessVersion, isVerifiedHarnessVersion, compatibleHarnessView };
