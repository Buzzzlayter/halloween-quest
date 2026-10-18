---
name: halloween-deploy
description: Publish and verify the Halloween quest at halloween-quest.buzzzlayter.workers.dev. Use for requests such as «задеплой квест», «обнови сайт Хэллоуина» or «опубликуй карточки», and for checking this project's deployment. Scoped to the existing halloween-quest Cloudflare Worker.
---

# Halloween deployment

## Project and target

- Workspace: `C:/Users/buzzz/OneDrive/Desktop/Hallowen`.
- Worker: `halloween-quest`.
- Production URL: `https://halloween-quest.buzzzlayter.workers.dev/`.
- Existing QR links: `/?id=1` through `/?id=8`; derive all current IDs from `dist/assets/tasks.js`, since more may be added.
- `npm.cmd run deploy` builds `publish/index.html` and runs the locally installed Wrangler. Images, video posters, CSS and JavaScript are embedded in HTML. Optional videos are separate content-hashed MP4 files in `publish/`; deploy the whole directory, not just HTML.

Use PowerShell with `workdir` set to the workspace. Use `npm.cmd`, since this machine blocks `npm.ps1`. Dependencies are already installed; reinstall only when missing or changed.

## Deploy

Treat a request to deploy this project as authorization to publish to this existing target. Do not request an extra conversational confirmation; comply with native execution approvals. A request only to inspect, explain or create the skill does not authorize publication.

1. Read `wrangler.jsonc` and `package.json` to confirm the Worker name, `assets.directory: ./publish`, and the actual deploy command. Inspect Git status if needed to identify the current changes. Do not switch accounts, domains or Worker names implicitly. Do not commit or push as part of deployment unless requested.
2. Run `npm.cmd run deploy` in a retained execution session and poll until completion. Respect filesystem and network permissions; request escalation for sandbox failures instead of changing global settings. The build is already part of this command: do not add a duplicate build or dry run on the normal successful path.
3. If authentication is missing or expired, run `npm.cmd run cloudflare:login` once. It uses `wrangler login --device`; show the verification URL and short user code, keep the session alive and wait for the user to authorize. Do not ask for API tokens or read credential files. The localhost OAuth callback was unreliable here, so keep device authorization. Retry the deploy once after successful login. If login expires or the same failure repeats, report the specific blocker instead of restarting indefinitely.
4. Require a successful Wrangler result and the expected production URL. If the account or destination is ambiguous, resolve the target before publishing. If Wrangler warns about overwriting dashboard-managed code for this confirmed Worker, the user's deployment request covers updating it.
5. Verify the result using this skill's helper, replacing `SKILL_DIR` with the actual directory containing this `SKILL.md`:

   ```powershell
   node "SKILL_DIR/scripts/verify-deployment.mjs" "C:/Users/buzzz/OneDrive/Desktop/Hallowen"
   ```

   The helper checks the local bundle against task content, then verifies the home page and every task URL against the exact published HTML. If videos are present, it also checks their bytes, MIME types and HTTP byte-range playback. If the server ignores Range but returns the exact full MP4, the helper warns instead of treating the valid file as corrupt; relay this limitation and require on-device playback verification rather than claiming streaming support. It retries a failed HTTP file check once for transient propagation. A failed verification does not authorize a second deployment or rollback: report what failed and inspect safely.

6. Reply briefly in Russian with the production link, number of task URLs verified, and whether QR addresses stayed the same. Include any remaining verification limit. Keep OAuth tokens and callback codes out of output.

## Read-only checks

- For a deployment check without publication, run the helper directly. It exits if the local build is stale; describe that difference rather than asserting that production is broken.
- To validate a prepared bundle without network access, add `--offline` to the helper command.
- For a requested build-only rehearsal, `npm.cmd run deploy:check` builds and executes Wrangler with `--dry-run`. Do not use it as a substitute for a requested live release.
