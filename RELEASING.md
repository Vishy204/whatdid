# Releasing

How a new version of what did goes out. The version lives in three files and must match in all of them, because Claude Code only updates an installed plugin when `plugin.json`'s version changes.

## 1. Prepare

- Bump `version` in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
- Add a section to `CHANGELOG.md`.
- Keep README images and links relative (`assets/hero.gif`). GitHub renders them even while the repo is private, and npmjs.com resolves them against the `repository` in `package.json`, so they show on npm once the repo is public.
- If the output changed, regenerate the README media: `python assets/src/make_gifs.py`, and re-shoot `assets/report.png` from `wd html` on the demo session.

## 2. Check

```bash
npm test                      # every test, on your OS
claude plugin validate .      # plugin and marketplace manifests
npm pack --dry-run            # the npm package: scripts, skills, hooks, docs; no tests or bench data
```

Push to `main` and wait for CI to pass on Linux, macOS and Windows. The permission tests only run on macOS and Linux, so CI is where they're checked.

## 3. Publish

```bash
git tag v0.1.11 && git push origin v0.1.11
gh release create v0.1.11 --title "what did 0.1.11" --notes-file <(sed -n '/^## 0.1.11/,/^## 0.1.10/p' CHANGELOG.md | sed '$d')
npm publish                   # runs the tests first (prepublishOnly)
```

Use the new version number in place of 0.1.11.

## 4. Verify from a clean setup

Use a machine or account that has never had what did installed, or a throwaway Claude Code config:

```bash
CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add Vishy204/whatdid
CLAUDE_CONFIG_DIR=… claude plugin install whatdid@whatdid
npx whatdid@latest help
npx whatdid@latest doctor
```

Then, in Claude Code: give it a task, type `wd`, `wd diff`, `wd html`, and pick `/wd` from the menu. Existing users get the update with `/plugin marketplace update whatdid`, then a restart.
