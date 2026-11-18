import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The Claude Code hook that refuses writing files from the shell (`>`, `tee`,
// `sed -i`, `Set-Content`, `node -e "writeFileSync"` ...) outside `.ai/tmp/`
// and the system temp folder. The process tests run the real script with a
// hook event on stdin, as Claude Code does: exit 2 blocks, exit 0 lets it through.
const hookUrl = new URL("../../.claude/hooks/block-shell-file-writes.mjs", import.meta.url);
const script = fileURLToPath(hookUrl);
const { findShellFileWrites, isAllowedTarget } = (await import(hookUrl.href)) as {
  findShellFileWrites: (command: unknown, shell?: string) => string[];
  isAllowedTarget: (target: string) => boolean;
};

function runHook(event: unknown) {
  const result = spawnSync(process.execPath, [script], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

const shellEvent = (tool_name: "Bash" | "PowerShell", command: string) => ({
  tool_name,
  tool_input: { command },
});

const blockedBash = [
  "echo hi > src/app.ts",
  "echo hi >> notes.md",
  "echo hi>out.txt",
  "printf x 1> out.txt",
  "npm test 2> errors.log",
  "ls &> all.log",
  "cat <<EOF > docs/x.md\nhello\nEOF",
  "cat > file.txt <<'EOF'\nline\nEOF",
  "echo x | tee README.md",
  "echo x | tee -a log.md",
  "npm run lint 2>&1 | tee lint.log",
  "sed -i 's/a/b/' src/x.ts",
  "sed -i.bak -e 's/a/b/' f.txt",
  "sed -Ei 's/a/b/' f.txt",
  "perl -pi -e 's/a/b/' f.txt",
  `node -e "require('fs').writeFileSync('src/x.ts', 'y')"`,
  `node -e "fs.appendFileSync(p, 'y')"`,
  `node -e "require('fs').writeFileSync('.ai/tmp/../src/x.ts', 'y')"`,
  `python -c "open('a.txt','w').write('x')"`,
  `python3 -c "from pathlib import Path; Path('a.md').write_text('x')"`,
  "python - <<EOF\nopen('x.txt', 'a').write('y')\nEOF",
  `bash -c "echo x > f.txt"`,
  "echo $(date) > stamp.txt",
  "cp .ai/tmp/draft.ts src/draft.ts",
  "cd .ai/tmp && echo x > ../../src/a.ts",
  "echo x > .ai/tmp/../src/a.ts",
  "dd if=/dev/zero of=big.bin count=1",
  "echo x \\\n  > split.txt",
  "eval 'echo x > f.txt'",
  "echo x > src/a.ts",
  "echo x > $ROOT/src/a.ts",
  "echo x > $PWD/a.txt",
  "echo x > ${ROOT}/docs/a.md",
  "echo a#b > out.txt",
  "echo x # note\necho y > out.txt",
  "npm test # one\n# two\ncat <<EOF > notes.md\nhi\nEOF",
  "echo x > $TMPDIR/../src/a.ts",
  // An expression as the target is read whole.
  "echo x > $(pwd)/src/a.ts",
  "echo x > $(echo src/a.ts)",
  `echo x > "$(dirname $0)/a.ts"`,
  "echo x | tee $(pwd)/src/a.ts",
  "echo x > $(mktemp)/../a.ts",
  // A variable assigned a literal in the same command is replaced by its value.
  "X=src/a.ts; echo x > $X",
  'X=src/a.ts\necho x > "$X"',
  "export X=src/a.ts; echo x > $X",
  "export X=src/a.ts && echo x | tee ${X}",
  "D=$PWD; echo x > $D/a.ts",
  "A=src; B=$A/a.ts; echo x > $B",
  "OUT=/tmp/x; OUT=src/a.ts; echo x > $OUT",
  // The home folder counts like `~`.
  "echo x > $HOME/Projekty/Krajozbior/krajozbior/src/a.ts",
  "echo x > ${HOME}/notes.txt",
  "echo x > ~/notes.txt",
  // A variable assigned a command substitution counts as that expression.
  "X=$(echo src/a.ts); echo x > $X",
];

const blockedPowerShell = [
  "Set-Content -Path src/a.ts -Value 'x'",
  "Set-Content src/a.ts 'x'",
  "'x' | Add-Content notes.md",
  "Get-Process | Out-File procs.txt",
  "Get-Process | Out-File -FilePath procs.txt -Append",
  "New-Item -ItemType File -Path a.txt -Value 'x'",
  "[IO.File]::WriteAllText('C:\\repo\\a.txt', 'x')",
  `[System.IO.File]::AppendAllText("$PWD\\a.txt", 'x')`,
  `"x" > out.txt`,
  "npm test *> all.log",
  "'x' | Tee-Object -FilePath out.txt",
  "'x' | tee out.txt",
  `cmd /c "echo x > f.txt"`,
  `powershell -NoProfile -Command "Set-Content f.txt x"`,
  "sc a.txt 'x'",
  "Get-ChildItem | ForEach-Object { Set-Content src\\$($_.Name) 'x' }",
  "Set-Content -Path src/a.ts -Value 1",
  "Set-Content -Path $PSScriptRoot\\a.ts -Value 1",
  "Get-Process | Out-File $ROOT/src/o.txt",
  "Get-Process | Out-File -FilePath src\\o.txt # x > y",
  "# comment\nSet-Content a.txt x",
  "<# note #> Set-Content a.txt x",
  "Copy-Item -Path $env:TEMP\\x.ts -Destination src\\x.ts",
  "@'\nline with > inside\n'@ | Set-Content a.md",
  "$text | Set-Content",
  // An expression as the target is read whole.
  "Set-Content -Path (Join-Path $PWD 'src\\a.ts') -Value x",
  "Set-Content -Path (Resolve-Path src\\a.ts) -Value x",
  "Set-Content -Path ('src\\a.ts') -Value x",
  `"x" > (Join-Path $PWD 'src\\a.ts')`,
  "'x' | Out-File (Join-Path $PSScriptRoot 'a.ts')",
  "Set-Content (Join-Path $PSScriptRoot 'a.ts') x",
  "Set-Content -Path (Join-Path $env:TEMP '..\\src\\a.ts') -Value x",
  "Add-Content -Path (Join-Path (Get-Location) 'notes.md') -Value x",
  // A variable assigned a literal in the same command is replaced by its value.
  `$x = "src\\a.ts"; "y" | Set-Content $x`,
  `$x = "src\\a.ts"; "y" > $x`,
  "$p = 'src/a.ts'\nSet-Content -Path $p -Value $c",
  "$d = $PWD; Set-Content -Path $d\\a.txt -Value x",
  `$p = "$env:TEMP\\a.txt"; $p = "src\\a.ts"; Out-File $p`,
  // A variable assigned a command or expression without parentheses counts as that expression.
  "$p = Join-Path $PWD 'src\\a.ts'; Set-Content $p 1",
  "$p = Join-Path $PWD 'src\\a.ts'; Set-Content -Path $p -Value 1",
  "$p = [IO.Path]::Combine($PWD,'src\\a.ts'); Set-Content $p 1",
  // The user profile counts like `~`.
  "Set-Content -Path $env:USERPROFILE\\x.txt -Value x",
  "Set-Content -Path $HOME/x.txt -Value x",
];

const allowedBash = [
  `git commit -m "a > b"`,
  `git -c user.name="M S" commit -m "fix: x -> y"`,
  `grep "x>y" src`,
  "grep 'a>b' -r .",
  "grep x\\>y src",
  "[ $a -gt 3 ] && echo ok",
  "if [[ $a > $b ]]; then echo a; fi",
  "echo $((3 > 2))",
  `node -e "const f = (a) => a * 2; console.log(f(2))"`,
  `node -e "console.log(require('fs').readFileSync('package.json','utf8'))"`,
  `python -c "print(open('a.txt').read())"`,
  "npm test 2>/dev/null",
  "npm run lint 2>&1 | tail -n 20",
  "echo err >&2",
  "npm run lint > .ai/tmp/hook/lint.log 2>&1",
  "npx vitest run 2>&1 | tee .ai/tmp/hook/vitest.log",
  "echo x > /tmp/scratch.txt",
  `echo x > "$TMPDIR/a.txt"`,
  "echo x > C:/Users/me/AppData/Local/Temp/claude/a.txt",
  "echo x > ../other-worktree/.ai/tmp/a.txt",
  "git commit -F .ai/tmp/msg.txt",
  "git commit -F - <<'EOF'\nfeat: a > b\nEOF",
  `gh pr create --title "x" --body "$(cat <<'EOF'\nA => B > C\nEOF\n)"`,
  "npx prettier --write src/a.ts",
  "npx eslint --fix src",
  "sed -n '1,5p' file.txt",
  "ls | tee /dev/null",
  "ls | tee",
  "cd .ai/tmp/hook && echo x > notes.txt",
  `node -e "require('fs').writeFileSync('.ai/tmp/out.json', d)"`,
  "cp src/a.ts .ai/tmp/a.ts",
  `git log --format="%h > %s" -5`,
  `bash -c "npm test 2>/dev/null"`,
  "cat <<EOF\n> not a redirect\nEOF",
  // Comments are text.
  "npm test # wynik > 0",
  "# a > b",
  "# sprawdzam wynik > 0\nnpm test",
  "npm test\n  # a > b\nnpm run lint",
  `echo "a # b" # c > d`,
  "echo ${#arr} $# url#frag",
  "git commit -m 'x' # don't > y",
  // A target that is a variable or an expression cannot be read: let it through.
  "ls > $LOG",
  "ls > ${TMPDIR:-/tmp}/o.txt",
  `ls > "$OUT/a.txt"`,
  "echo x > $(mktemp)",
  // An expression or a variable that names temp.
  `echo x > "$(mktemp -d)/a.txt"`,
  "echo x > $(mktemp -d)/a.txt",
  "echo x > $TMPDIR/$(date +%s).log",
  "OUT=/tmp/x; ls > $OUT/a.txt",
  'OUT=/tmp/x; ls > "${OUT}/a.txt"',
  "OUT=$(mktemp -d); ls > $OUT/a.txt",
  "LOG=/tmp/x.log; export LOG; ls > $LOG",
  "X=1 echo x > /tmp/a",
  "echo $(date) $(pwd)",
  "echo x | tee /tmp/$(date +%s).log",
  `npx tsc --listFilesOnly -p . > "$TMP/x.txt" 2>/dev/null`,
  `gh api -X POST repos/o/r/statuses/$SHA -f description="a > b #3"`,
];

const allowedPowerShell = [
  "npm test 2>$null",
  "Get-Content a.txt | Out-Null",
  `"x" > $null`,
  "Set-Content -Path .ai/tmp/hook/a.txt -Value x",
  "Out-File -FilePath $env:TEMP\\a.txt",
  "Get-ChildItem | Where-Object { $_.Length -gt 1000 }",
  "npm run build *>&1 | Select-Object -Last 20",
  "New-Item -ItemType Directory -Path src/new",
  `[IO.File]::WriteAllText("$env:TEMP\\x.txt", 'y')`,
  `Write-Output "a > b"`,
  `cmd /c "dir > nul"`,
  "'x' | Tee-Object -Variable v",
  "@'\nfeat: a > b\n'@ | git commit -F -",
  "Copy-Item src\\a.ts .ai\\tmp\\a.ts",
  "Get-Process # x > y",
  "<# a > b #> Get-Process",
  "Get-Process <#\n a > b\n#> | Out-Null",
  "# a > b\nGet-Process",
  "Get-Process | Out-File $out",
  `$out = "$env:TEMP\\a.txt"; Get-Process | Out-File $out`,
  `Set-Content -Path (Join-Path $env:TEMP "a.txt") -Value x`,
  `Set-Content -Path "$env:LOCALAPPDATA\\Temp\\a.txt" -Value x`,
  `Set-Content -Path $env:LOCALAPPDATA\\Temp\\a.txt -Value x`,
  "Get-Process > $log",
  // An expression or a variable that names temp.
  `Set-Content -Path (Join-Path $env:TEMP "a.txt") -Value x`,
  `"x" > (Join-Path $env:TEMP 'a.txt')`,
  `Set-Content (Join-Path $env:LOCALAPPDATA 'Temp\\a.txt') x`,
  "Set-Content -Path ([IO.Path]::GetTempFileName()) -Value x",
  `Set-Content -Path (Join-Path $env:TEMP "a,b.txt") -Value (Get-Content in.txt)`,
  `$p = "$env:TEMP\\a.txt"; "y" | Set-Content $p`,
  "$p = (Join-Path $env:TEMP 'a.txt'); Set-Content $p x",
  "$out = 'C:\\Users\\me\\AppData\\Local\\Temp\\a.txt'; Out-File $out",
  "$p = Join-Path $env:TEMP 'a.txt'; Set-Content $p 1",
  `$os = Get-CimInstance Win32_OperatingSystem; "{0:N1}" -f $os.FreePhysicalMemory`,
  "$x = Join-Path $PWD 'src'; Get-ChildItem $x",
  "$x = 5; if ($x -gt 3) { Write-Output ok }",
  `"{0:N1}" -f (3.14159)`,
  "Get-ChildItem src | Out-String -Width 200",
  "foreach ($f in ls) { if ($f.Length -gt 1000) { $f.Name } }",
  `git commit -m "a > b"`,
];

describe("findShellFileWrites", () => {
  it.each(blockedBash)("blocks (Bash): %s", (command) => {
    expect(findShellFileWrites(command, "bash")).not.toEqual([]);
  });

  it.each(blockedPowerShell)("blocks (PowerShell): %s", (command) => {
    expect(findShellFileWrites(command, "powershell")).not.toEqual([]);
  });

  it.each(allowedBash)("allows (Bash): %s", (command) => {
    expect(findShellFileWrites(command, "bash")).toEqual([]);
  });

  it.each(allowedPowerShell)("allows (PowerShell): %s", (command) => {
    expect(findShellFileWrites(command, "powershell")).toEqual([]);
  });

  it("names the target of a redirect", () => {
    expect(findShellFileWrites("echo x > src/a.ts 2>/dev/null")).toEqual([
      'przekierowanie do "src/a.ts"',
    ]);
  });

  it("says when the target is an expression or a variable with a known value", () => {
    expect(findShellFileWrites("echo x > $(pwd)/a.ts").join()).toContain(
      "cel zapisu jest wyrażeniem",
    );
    expect(findShellFileWrites("echo x > (Join-Path $PWD a.ts)", "powershell").join()).toContain(
      ".ai/tmp/",
    );
    expect(findShellFileWrites("X=src/a.ts; echo x > $X")).toEqual([
      'przekierowanie do "$X" (= "src/a.ts")',
    ]);
  });

  it("gives a clear reason when a cmdlet has no target file", () => {
    expect(findShellFileWrites("$text | Set-Content", "powershell").join()).toContain(
      "bez podanego pliku docelowego",
    );
  });

  it("reads `sc` as Set-Content only in PowerShell", () => {
    expect(findShellFileWrites("sc a.txt x", "powershell")).not.toEqual([]);
    expect(findShellFileWrites("sc query", "bash")).toEqual([]);
  });

  it("ignores a command that is not a string", () => {
    expect(findShellFileWrites(undefined)).toEqual([]);
    expect(findShellFileWrites(42)).toEqual([]);
  });

  it("knows the allowed targets", () => {
    for (const target of ["/dev/null", "$null", "NUL", ".ai/tmp/x", "%TEMP%\\x", "$env:TEMP\\x"]) {
      expect(isAllowedTarget(target)).toBe(true);
    }
    for (const target of [
      "src/x.ts",
      ".ai/tmpx",
      ".ai/tmp/../x",
      "/tmp/../etc/x",
      "$PWD/x",
      "$ROOT/src/x",
      "$HOME/x",
      "${HOME}/x",
      "$env:USERPROFILE\\x",
      "(Join-Path $PWD 'a')",
      "$(pwd)/a",
    ]) {
      expect(isAllowedTarget(target)).toBe(false);
    }
    for (const target of ["$LOG", "${TMPDIR:-/tmp}/o.txt", "$env:LOCALAPPDATA\\Temp\\a"]) {
      expect(isAllowedTarget(target)).toBe(true);
    }
  });
});

describe("block-shell-file-writes hook (real process)", () => {
  it("blocks a Bash redirect with exit 2 and a Polish hint", () => {
    const result = runHook(shellEvent("Bash", "cat <<EOF >> docs/run.md\nentry\nEOF"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Zablokowano zapis do pliku z powłoki");
    expect(result.stderr).toContain("Edit/Write");
    expect(result.stderr).toContain(".ai/tmp/");
  });

  it("blocks Set-Content from the PowerShell tool", () => {
    expect(runHook(shellEvent("PowerShell", "Set-Content src/a.ts 'x'")).status).toBe(2);
  });

  it("uses PowerShell aliases only for the PowerShell tool", () => {
    expect(runHook(shellEvent("PowerShell", "sc a.txt x")).status).toBe(2);
    expect(runHook(shellEvent("Bash", "sc query")).status).toBe(0);
  });

  it("lets a log in .ai/tmp through", () => {
    expect(runHook(shellEvent("Bash", "npm run lint > .ai/tmp/lint.log 2>&1")).status).toBe(0);
  });

  it("lets an event without a command through", () => {
    expect(runHook({ tool_name: "Bash", tool_input: {} }).status).toBe(0);
  });

  it("exits 1 for a malformed event (a hook bug, not a block)", () => {
    expect(runHook("not json").status).toBe(1);
  });
});
