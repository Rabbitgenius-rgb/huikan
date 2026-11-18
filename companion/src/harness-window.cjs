'use strict';
const { execFile } = require('node:child_process');

const reopenHarness = `
ObjC.import('AppKit');
function run(argv) {
  const pid = Number(argv[0]);
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (!app || app.isNil() || ObjC.unwrap(app.bundleIdentifier) !== 'com.deepseek.dsh') return false;
  if (app.hidden) app.unhide;

  // Ask the exact running instance to restore its window through its open URL handler.
  const getUrl = 0x4755524c; // GURL
  const target = $.NSAppleEventDescriptor.descriptorWithProcessIdentifier(pid);
  const event = $.NSAppleEventDescriptor.appleEventWithEventClassEventIDTargetDescriptorReturnIDTransactionID(getUrl, getUrl, target, -1, 0);
  event.setParamDescriptorForKeyword($.NSAppleEventDescriptor.descriptorWithString('dsh://open'), 0x2d2d2d2d); // ----
  const noReplyOrConsentPrompt = 0x00800001;
  const sent = !event.sendEventWithOptionsTimeoutError(noReplyOrConsentPrompt, 1, null).isNil();
  const activateAllWindowsIgnoringOtherApps = 3;
  return app.active || app.activateWithOptions(activateAllWindowsIgnoringOtherApps) || sent;
}
`;

function activateHarnessWindow(pid) {
  return new Promise(resolve => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', reopenHarness, String(pid)],
      { timeout: 2000 }, (error, stdout) => resolve(!error && stdout.trim() === 'true'));
  });
}

module.exports = { activateHarnessWindow };
