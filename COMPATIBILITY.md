# DSH compatibility

Supported runtime line: `>=0.2.1-rc.2 <0.3.0-0`.

DSH prereleases participate in its compatibility checks. Patch and prerelease
updates within the 0.2 line can load this plugin without exact-version overrides.
The next minor (including its prereleases) requires review; future APIs cannot
be guaranteed compatible by a version range alone.

The DSH compatibility workflow tests the baseline and npm's `latest` DSH on
pull requests, pushes, manual runs, and weekly. It aligns the actual DSH host
packages, builds the plugin, checks host imports and browser module declarations,
runs the existing behavioral tests, and checks the packed package's exports.
A failure against latest is a request to investigate before upgrading support,
not a reason to disable DSH's compatibility protection.

To reproduce with dependencies installed against the chosen DSH:

```sh
npm run build --if-present
npm run check:dsh
npm test
```

These checks do not download models or prove GPU/engine performance. Existing
native-runtime and hardware validation procedures still apply.
