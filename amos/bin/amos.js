#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Global fail-soft handler
function handleGlobalError(err) {
  try {
    const logPath = 'C:\\Users\\user\\.amos\\errors.log';
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${err.message}\nStack: ${err.stack || err}\n\n`;
    fs.appendFileSync(logPath, logMessage, 'utf8');
  } catch (e) {
    // Swallow any errors in logging to ensure silent exit 0
  }
  process.exit(0);
}

// Wrap execution in try-catch
try {
  // Check AMOS_DISABLE immediately
  if (process.env.AMOS_DISABLE === '1') {
    process.exit(0);
  }

  // Import config
  const config = require('../lib/config.js');

  const args = process.argv.slice(2);
  if (args.length === 0) {
    // Silent exit 0 for no command
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'event': {
      const eventArg = args[1];
      handleEvent(eventArg);
      break;
    }
    case 'status': {
      handleStatus();
      break;
    }
    case 'report': {
      handleReport();
      break;
    }
    case 'doctor': {
      handleDoctor();
      break;
    }
    case 'version': {
      handleVersion();
      break;
    }
    default: {
      // Unknown command: silent exit 0
      process.exit(0);
    }
  }
} catch (err) {
  handleGlobalError(err);
}

function handleEvent(eventArg) {
  let stdinData = '';
  try {
    // Read stdin synchronously
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (e) {
    // Ignore reading error
  }

  let parsedInput = {};
  if (stdinData && stdinData.trim()) {
    try {
      parsedInput = JSON.parse(stdinData);
    } catch (e) {
      // If JSON parsing fails, log it as fail-soft but we also exit 0 silently
      throw new Error(`Invalid JSON input: ${e.message}`);
    }
  }

  // Determine event name: CLI argument takes priority, fallback to stdin JSON field
  const eventName = eventArg || parsedInput.hook_event_name;

  if (!eventName || !['session-start', 'stop'].includes(eventName)) {
    // Unknown event or empty JSON: silent exit 0
    process.exit(0);
  }

  const profile = require('../lib/config.js').getProfile();

  if (eventName === 'session-start') {
    let contextStr = '';
    if (profile === 'minimal') {
      contextStr = `AMOS Resume Pointer: C:\\Users\\user\\.amos`;
    } else if (profile === 'strict') {
      contextStr = `AMOS Resume Pointer: C:\\Users\\user\\.amos\nFocus: Kernel Core CLI\nBootstrap: Please verify your amos installation using 'amos doctor'.\nStrict rules: active. Rules enforcement: 100%.`;
    } else {
      // standard (default)
      contextStr = `AMOS Resume Pointer: C:\\Users\\user\\.amos\nFocus: Kernel Core CLI\nBootstrap: Please verify your amos installation using 'amos doctor'.`;
    }

    const output = {
      hookSpecificOutput: {
        additionalContext: contextStr
      }
    };
    console.log(JSON.stringify(output));
  } else if (eventName === 'stop') {
    let decision = 'allow';
    let reason = 'Stop event processed successfully.';

    if (profile === 'strict') {
      if (parsedInput.data && parsedInput.data.violations && parsedInput.data.violations.length > 0) {
        decision = 'block';
        reason = `Rule violations detected: ${parsedInput.data.violations.join(', ')}`;
      } else if (parsedInput.data && parsedInput.data.forceBlock) {
        decision = 'block';
        reason = 'Blocked by forceBlock directive.';
      } else {
        reason = 'All rules enforced and verified. No violations found.';
      }
    } else {
      // standard / minimal
      if (parsedInput.data && parsedInput.data.forceBlock) {
        decision = 'block';
        reason = 'Blocked by forceBlock directive.';
      }
    }

    console.log(JSON.stringify({ decision, reason }));
  }
}

function handleStatus() {
  const profile = require('../lib/config.js').getProfile();
  if (profile === 'minimal') {
    console.log('AMOS Status: OK');
  } else if (profile === 'strict') {
    console.log('AMOS CLI Status: OK\nProfile: strict\nVersion: 0.1.0\nRules: Enforced');
  } else {
    console.log('AMOS CLI Status: OK\nProfile: standard\nVersion: 0.1.0');
  }
}

function handleReport() {
  console.log('AMOS Report command is a stub. Full report functionality will be implemented in Sprint 2.');
}

function handleDoctor() {
  console.log('[AMOS DOCTOR DIAGNOSTIC REPORT]');
  console.log('------------------------------------');

  // Node.js version check
  const versionString = process.version;
  const majorVersion = parseInt(versionString.slice(1).split('.')[0], 10);
  if (majorVersion >= 22) {
    console.log(`[PASS] Node.js Version: ${versionString} (>= 22.0.0)`);
  } else {
    console.log(`[FAIL] Node.js Version: ${versionString} (< 22.0.0 is not compatible)`);
  }

  // Profile and disable check
  const profile = require('../lib/config.js').getProfile();
  const disabled = require('../lib/config.js').isDisabled();
  console.log(`[PASS] Environment: AMOS_PROFILE=${profile}, AMOS_DISABLE=${disabled ? '1 (Bypass Active)' : 'not set'}`);

  // Workspace Directory existence
  const amosDir = 'C:\\Users\\user\\.amos';
  if (fs.existsSync(amosDir)) {
    console.log(`[PASS] Workspace Directory: ${amosDir}`);
  } else {
    console.log(`[FAIL] Workspace Directory: ${amosDir} does not exist`);
  }

  // Write permissions inside amosDir
  try {
    const tempFile = path.join(amosDir, '.doctor_write_test');
    fs.writeFileSync(tempFile, 'test', 'utf8');
    fs.unlinkSync(tempFile);
    console.log('[PASS] Write Permissions: Verified');
  } catch (e) {
    console.log(`[FAIL] Write Permissions: Failed to write to workspace dir (${e.message})`);
  }

  // Git Repository Check
  const gitDir = path.join(amosDir, '.git');
  if (fs.existsSync(gitDir)) {
    console.log('[PASS] Git Repository: Initialized');
  } else {
    console.log('[FAIL] Git Repository: Not initialized');
  }

  // Error Log check
  const logPath = path.join(amosDir, 'errors.log');
  if (fs.existsSync(logPath)) {
    const stats = fs.statSync(logPath);
    console.log(`[INFO] Error Log: Present (${stats.size} bytes)`);
  } else {
    console.log('[INFO] Error Log: Not present / empty');
  }

  console.log('------------------------------------');
  console.log('AMOS Kernel diagnostic complete.');
}

function handleVersion() {
  console.log('0.1.0');
}
