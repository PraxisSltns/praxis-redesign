# Branches, CI and merging

## The flow

```
push to dev  ->  ci.yml "test" (npm ci, unit tests, build)
             ->  green: ci.yml "open-pr" opens or updates the one dev -> main pull request (github-actions[bot])
a person approves the pull request
             ->  automerge.yml merges it with a merge commit, using MERGE_TOKEN
             ->  push to main  ->  ci.yml "test" runs on main
             ->  Railway deploys staging from main once that check is green ("Wait for CI")
Vercel builds the app from dev only, in mock mode (vercel.json, docs/deploy/vercel.md)
developers run the backend locally with docker compose (docs/development.md)
```

- `dev` is where work lands and is the default branch. Nobody pushes to `main` directly.
- The required check is the job named `test` in `ci.yml`. Renaming the job breaks branch protection.
- The merge is a merge commit, not a squash, so `main` always contains `dev`'s commits and the two never diverge.
- Why a separate merge token: GitHub doesn't start new workflow runs for events made with `GITHUB_TOKEN`. A merge made with it would never run `ci.yml` on `main`, and Railway's "Wait for CI" would wait for nothing.
- Why the pull request is opened with `GITHUB_TOKEN`: its author is then `github-actions[bot]`, so any person, the developer included, can approve it.

## One-time setup (a repository admin runs these)

Replace `OWNER/REPO` with `bobibcgroup/praxis-redesign`.

1. Push `dev` and make it the default branch:

   ```bash
   git push -u origin dev
   gh repo edit OWNER/REPO --default-branch dev
   ```

2. Let Actions open pull requests (Settings > Actions > General > Workflow permissions > "Allow GitHub Actions to create and approve pull requests"):

   ```bash
   gh api -X PUT repos/OWNER/REPO/actions/permissions/workflow \
     -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true
   ```

3. Allow merge commits on the repository:

   ```bash
   gh api -X PATCH repos/OWNER/REPO -F allow_merge_commit=true
   ```

4. Protect `main`: a pull request with one approval, the `test` check green and up to date, no direct or force pushes, admins included:

   ```bash
   gh api -X PUT repos/OWNER/REPO/branches/main/protection --input - <<'JSON'
   {
     "required_status_checks": { "strict": true, "checks": [{ "context": "test" }] },
     "enforce_admins": true,
     "required_pull_request_reviews": { "required_approving_review_count": 1, "dismiss_stale_reviews": true },
     "restrictions": null,
     "allow_force_pushes": false,
     "allow_deletions": false
   }
   JSON
   ```

   With `enforce_admins` on, an admin can't push to `main` either. Set it to `false` only if an emergency fix must bypass the flow.

5. Protect `dev` against force pushes and deletion (pushes stay open):

   ```bash
   gh api -X PUT repos/OWNER/REPO/branches/dev/protection --input - <<'JSON'
   {
     "required_status_checks": null,
     "enforce_admins": true,
     "required_pull_request_reviews": null,
     "restrictions": null,
     "allow_force_pushes": false,
     "allow_deletions": false
   }
   JSON
   ```

6. The merge token. Create a fine-grained personal access token (GitHub > Settings > Developer settings > Fine-grained tokens) owned by a person who can merge into `main`. Give it **only this repository**, with permissions **Contents: Read and write** and **Pull requests: Read and write**, and an expiry date you'll remember to renew. Then:

   ```bash
   gh secret set MERGE_TOKEN --repo OWNER/REPO   # paste the token when asked
   ```

   The approver must be a different person from the token's owner only if GitHub would otherwise count the merge as self-approval. Here the pull request author is `github-actions[bot]`, so it isn't.

## Checking it works

1. Push a commit to `dev` that makes one test fail. `test` goes red, `open-pr` is skipped, and the pull request can't be merged. Revert it.
2. Push a green commit to `dev`. `open-pr` opens or updates the pull request, authored by `github-actions[bot]`.
3. Approve the pull request. `automerge.yml` merges it, `ci.yml` runs on `main`, and Railway deploys staging after that run is green.
