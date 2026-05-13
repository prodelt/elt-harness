const assert = require("assert");

const {
  getExitCode,
  handleInput,
  isSuccessfulCommit,
  shouldHandleCommand,
} = require("./graphify-post-commit");

function createSpawnRecorder() {
  const calls = [];
  return {
    calls,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return {
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
          calls[calls.length - 1].unrefCalled = true;
        },
      };
    },
  };
}

try {
  assert.strictEqual(shouldHandleCommand("git commit -m \"test: graph\""), true);
  assert.strictEqual(shouldHandleCommand(" git commit --amend --no-edit "), true);
  assert.strictEqual(shouldHandleCommand("git status"), false);
  assert.strictEqual(shouldHandleCommand("npm test"), false);

  assert.strictEqual(getExitCode({ tool_response: { exit_code: 0 } }), 0);
  assert.strictEqual(getExitCode({ tool_response: { exitCode: 1 } }), 1);
  assert.strictEqual(getExitCode({ tool_result: { status: 2 } }), 2);
  assert.strictEqual(getExitCode({ tool_response: { output: "ok" } }), null);

  assert.strictEqual(
    isSuccessfulCommit({
      tool_response: { exit_code: 0, stdout: "[main abc1234] test: commit\n 1 file changed" },
    }),
    true
  );
  assert.strictEqual(
    isSuccessfulCommit({
      tool_response: { exit_code: 1, stderr: "nothing to commit, working tree clean" },
    }),
    false
  );
  assert.strictEqual(
    isSuccessfulCommit({
      tool_response: { output: "[feature/x 1234567] feat: add hook" },
    }),
    true
  );
  assert.strictEqual(
    isSuccessfulCommit({
      tool_response: { output: "error: pathspec did not match any file(s) known to git" },
    }),
    false
  );

  const spawnRecorder = createSpawnRecorder();
  const output = handleInput(
    {
      tool_name: "Bash",
      tool_input: { command: "git commit -m \"test: hook\"" },
      tool_response: { exit_code: 0, stdout: "[main abc1234] test: hook" },
      cwd: "C:/repo",
    },
    { spawnImpl: spawnRecorder.spawn }
  );
  assert.strictEqual(output, "");
  assert.strictEqual(spawnRecorder.calls.length, 1);
  assert.strictEqual(spawnRecorder.calls[0].command, "cmd");
  assert.deepStrictEqual(spawnRecorder.calls[0].args, ["/c", "graphify", "update", "."]);
  assert.strictEqual(spawnRecorder.calls[0].options.cwd, "C:/repo");
  assert.strictEqual(spawnRecorder.calls[0].options.detached, true);
  assert.strictEqual(spawnRecorder.calls[0].options.stdio, "ignore");
  assert.strictEqual(spawnRecorder.calls[0].unrefCalled, true);

  const skipped = handleInput(
    {
      tool_name: "Bash",
      tool_input: { command: "git commit -m \"test: skip\"" },
      tool_response: { exit_code: 1, stderr: "nothing to commit, working tree clean" },
      cwd: "C:/repo",
    },
    { spawnImpl: spawnRecorder.spawn }
  );
  assert.strictEqual(skipped, "");
  assert.strictEqual(spawnRecorder.calls.length, 1);

  process.stdout.write("graphify-post-commit.test.js PASS\n");
} catch (error) {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
}
