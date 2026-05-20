# Merging an open PR into your branch

If the pull request already exists on GitHub and points to another branch, you can merge its branch into your current branch locally.

## 1) Fetch latest refs

```bash
git fetch origin
```

## 2) Check out your target branch

```bash
git checkout <your-branch>
```

## 3) Merge the PR source branch

If you know the source branch name (for example `feature/image-source-controls`):

```bash
git merge origin/feature/image-source-controls
```

If you only know the PR number (for example PR `123`), fetch it then merge:

```bash
git fetch origin pull/123/head:pr-123
git merge pr-123
```

## 4) Resolve conflicts (if any), then commit

```bash
git add -A
git commit
```

## 5) Push your updated branch

```bash
git push origin <your-branch>
```

## Optional: rebase instead of merge

If you prefer a linear history:

```bash
git rebase origin/feature/image-source-controls
```

Then push with lease:

```bash
git push --force-with-lease origin <your-branch>
```
